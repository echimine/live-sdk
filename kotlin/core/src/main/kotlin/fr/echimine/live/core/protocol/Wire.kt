package fr.echimine.live.core.protocol

import fr.echimine.live.core.LiveConfig
import kotlinx.serialization.ExperimentalSerializationApi
import fr.echimine.live.core.ChatMessage
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** Encodage et décodage du fil, selon les conventions de `protocol/README.md`. */
internal object Wire {
    @OptIn(ExperimentalSerializationApi::class)
    val json: Json = Json {
        classDiscriminator = "type"
        // Les récepteurs ignorent les champs inconnus ; un champ optionnel absent est omis, jamais `null`.
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    /** `null` pour un message illisible ou d'un type inconnu : il est ignoré. */
    fun decodeServerMessage(text: String): ServerMessage? =
        try {
            json.decodeFromString(ServerMessage.serializer(), text)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }

    fun encodeClientMessage(message: ClientMessage): String =
        json.encodeToString(ClientMessage.serializer(), message)

    // ------------------------------------------------------------ config

    /**
     * Clé par clé : une clé absente ou invalide reprend la valeur par défaut.
     * `null` si le corps n'est pas un objet JSON (réponse d'un proxy, par exemple).
     */
    fun decodeConfig(text: String): LiveConfig? {
        val defaults = LiveConfig.Defaults
        val root = try {
            json.parseToJsonElement(text) as? JsonObject
        } catch (_: SerializationException) {
            null
        } ?: return null
        return LiveConfig(
            reactions = root["reactions"].stringList()?.takeIf { it.size in 4..16 } ?: defaults.reactions,
            chatMaxLength = root.child("chat")?.get("maxLength").positiveLong()?.toIntOrNull()
                ?: defaults.chatMaxLength,
            imagesMaxBytes = root.child("images")?.get("maxBytes").positiveLong() ?: defaults.imagesMaxBytes,
            imageFormats = root.child("images")?.get("formats").stringList()?.takeIf { it.isNotEmpty() }
                ?: defaults.imageFormats,
            productNameMaxLength = root.child("product")?.get("nameMaxLength").positiveLong()?.toIntOrNull()
                ?: defaults.productNameMaxLength,
        )
    }

    fun encodeConfig(config: LiveConfig): JsonElement = buildJsonObject {
        putJsonArray("reactions") { config.reactions.forEach { add(JsonPrimitive(it)) } }
        putJsonObject("chat") { put("maxLength", config.chatMaxLength) }
        putJsonObject("images") {
            put("maxBytes", config.imagesMaxBytes)
            putJsonArray("formats") { config.imageFormats.forEach { add(JsonPrimitive(it)) } }
        }
        putJsonObject("product") { put("nameMaxLength", config.productNameMaxLength) }
    }

    private fun JsonObject.child(key: String): JsonObject? = get(key) as? JsonObject

    private fun JsonElement?.stringList(): List<String>? {
        val array = this as? JsonArray ?: return null
        return array.map { item ->
            val primitive = item as? JsonPrimitive
            if (primitive == null || !primitive.isString || primitive.content.isEmpty()) return null
            primitive.content
        }
    }

    private fun JsonElement?.positiveLong(): Long? {
        val primitive = this as? JsonPrimitive ?: return null
        if (primitive.isString) return null
        return primitive.longOrNull?.takeIf { it > 0 }
    }

    private fun Long.toIntOrNull(): Int? = if (this <= Int.MAX_VALUE) toInt() else null

    // ------------------------------------------------------------ fixtures (Seam 2)

    fun roundTripServerMessage(text: String): JsonElement =
        json.encodeToJsonElement(ServerMessage.serializer(), json.decodeFromString(ServerMessage.serializer(), text))

    fun roundTripClientMessage(text: String): JsonElement =
        json.encodeToJsonElement(ClientMessage.serializer(), json.decodeFromString(ClientMessage.serializer(), text))

    fun roundTripConfig(text: String): JsonElement = encodeConfig(checkNotNull(decodeConfig(text)))

    fun roundTripHttp(name: String, text: String): JsonElement = when (name) {
        "lives.list.response" -> roundTrip(LivesListResponse.serializer(), text)
        "lives.create.request" -> roundTrip(LivesCreateRequest.serializer(), text)
        "lives.create.response" -> roundTrip(LivesCreateResponse.serializer(), text)
        "lives.summary.response" -> roundTrip(EndSummary.serializer(), text)
        "images.upload.response" -> roundTrip(ImagesUploadResponse.serializer(), text)
        // `error.<code>` : un corps d'erreur, un fichier par code.
        else -> if (name.startsWith("error.")) roundTrip(HttpErrorBody.serializer(), text) else error("fixture HTTP sans type Kotlin : $name")
    }

    private fun <T> roundTrip(serializer: KSerializer<T>, text: String): JsonElement =
        json.encodeToJsonElement(serializer, json.decodeFromString(serializer, text))
}

/** Liste de messages du chat dont les éléments illisibles (genre inconnu…) sont écartés un à un. */
internal object LenientChatMessages : KSerializer<List<ChatMessage>> {
    private val strict = ListSerializer(ChatMessage.serializer())

    override val descriptor: SerialDescriptor = strict.descriptor

    override fun serialize(encoder: Encoder, value: List<ChatMessage>) = strict.serialize(encoder, value)

    override fun deserialize(decoder: Decoder): List<ChatMessage> {
        val input = decoder as? JsonDecoder ?: return strict.deserialize(decoder)
        val array = input.decodeJsonElement() as? JsonArray ?: throw SerializationException("liste attendue")
        return array.mapNotNull { element ->
            try {
                input.json.decodeFromJsonElement(ChatMessage.serializer(), element)
            } catch (_: SerializationException) {
                null
            } catch (_: IllegalArgumentException) {
                null
            }
        }
    }
}

/** Horodatage ISO 8601 en UTC, toujours à la milliseconde comme le serveur (`toISOString`). */
internal object InstantSerializer : KSerializer<Instant> {
    private val format = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(format.format(value))

    override fun deserialize(decoder: Decoder): Instant =
        try {
            Instant.parse(decoder.decodeString())
        } catch (error: java.time.format.DateTimeParseException) {
            throw SerializationException(error.message)
        }
}
