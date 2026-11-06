package fr.echimine.live.core

import fr.echimine.live.core.protocol.InstantSerializer
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonClassDiscriminator
import java.time.Instant

/**
 * Toute personne présente dans un Live. [id] est opaque et attribué par le serveur commun ;
 * [app] est l'App d'origine. [picture] est absent si l'avatar manque : afficher l'initiale de [name].
 */
@Serializable
public data class Participant(
    val id: String,
    val app: String,
    val name: String,
    val picture: String? = null,
)

/**
 * Rôle d'un Participant dans un Live, décidé par le serveur commun seul.
 * Un rôle que cette version du SDK ne connaît pas (serveur plus récent) devient [Unknown], sans rendre
 * le `snapshot` illisible ; il est traité comme un Spectateur.
 */
@Serializable(with = RoleSerializer::class)
public enum class Role(internal val wire: String?) {
    Host("host"),
    Cohost("cohost"),
    Viewer("viewer"),

    /** Rôle inconnu de cette version du SDK : ni Animateur, ni Spectateur à proprement parler. */
    Unknown(null),
    ;

    /** L'Hôte ou un Co-hôte : peut épingler un Produit et modérer. */
    public val isAnimator: Boolean get() = this == Host || this == Cohost

    internal companion object {
        fun fromWire(role: String): Role = entries.firstOrNull { it.wire == role } ?: Unknown
    }
}

/**
 * Tolérant au décodage (valeur inconnue → [Role.Unknown]). Le SDK n'émet jamais de rôle : encoder
 * [Role.Unknown] est une erreur de programmation, signalée plutôt qu'inventée.
 */
internal object RoleSerializer : KSerializer<Role> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Role", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: Role) {
        encoder.encodeString(value.wire ?: throw SerializationException("Un rôle inconnu ne s'encode pas."))
    }

    override fun deserialize(decoder: Decoder): Role = Role.fromWire(decoder.decodeString())
}

/** Co-hôtes à l'écran au plus, aux côtés de l'Hôte (fixé par le serveur commun : `cohost_limit` au-delà). */
public const val MAX_COHOSTS: Int = 5

/** Le Produit épinglé d'un Live. [price] est en centimes, [currency] un code ISO 4217. */
@Serializable
public data class Product(
    val id: String,
    val name: String,
    val price: Int,
    val currency: String,
    val imageUrl: String? = null,
)

/** Le produit acheté, tel que l'Annonce d'achat le porte. */
@Serializable
public data class PurchasedProduct(
    val id: String,
    val name: String,
    val price: Int,
    val currency: String,
)

/** Un message du chat : un texte, ou une Annonce d'achat publiée par le Live lui-même. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
public sealed interface ChatMessage {
    public val id: String
    public val author: Participant

    /** Rôle de l'auteur au moment du message. */
    public val role: Role
    public val at: Instant

    @Serializable
    @SerialName("text")
    public data class Text(
        override val id: String,
        override val author: Participant,
        override val role: Role,
        @Serializable(with = InstantSerializer::class) override val at: Instant,
        val text: String,
    ) : ChatMessage

    /** Annonce d'achat : le prix est à formater selon la locale du téléphone. */
    @Serializable
    @SerialName("purchase")
    public data class Purchase(
        override val id: String,
        override val author: Participant,
        override val role: Role,
        @Serializable(with = InstantSerializer::class) override val at: Instant,
        val product: PurchasedProduct,
    ) : ChatMessage
}

/** Audience : Spectateurs connectés, Animateurs exclus, détaillée par App d'origine. */
@Serializable
public data class Audience(
    val total: Int,
    val byApp: Map<String, Int>,
) {
    /** [byApp] de l'App d'origine la plus présente à la moins présente, puis par nom. */
    public val ranked: List<Pair<String, Int>>
        get() = byApp.toList().sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first })
}

/** Un Live en cours, tel que listé. */
@Serializable
public data class LiveSummary(
    val id: String,
    val title: String? = null,
    val host: Participant,
    /** Audience totale (Animateurs exclus). */
    val audience: Int,
    @Serializable(with = InstantSerializer::class) val startedAt: Instant,
)

/** Shadowbans et Bannissements du Live, visibles des seuls Animateurs. */
public data class Moderation(
    val shadowbanned: List<Participant>,
    val banned: List<Participant>,
)

/** Récapitulatif de fin, reçu par l'Hôte seul. */
public data class LiveEndSummary(
    val purchases: Int,
    val reactions: Int,
    val peakAudience: Int,
)

/** Photo d'un produit à épingler : une URL https déjà en ligne, ou une image à envoyer au serveur commun. */
public sealed interface ProductImage {
    /** Transmise telle quelle (par exemple l'image d'une Source de produits). */
    public data class Url(val url: String) : ProductImage

    /** JPEG, PNG ou WebP : réduite par le SDK (1024 px au plus) puis envoyée via `POST /v1/images`. */
    public class Data(public val bytes: ByteArray) : ProductImage
}
