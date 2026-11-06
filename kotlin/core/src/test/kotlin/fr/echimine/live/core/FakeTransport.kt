package fr.echimine.live.core

import kotlinx.coroutines.channels.Channel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.io.IOException

private val fixturesDir = File(System.getProperty("live.fixtures") ?: "../../protocol/fixtures")

/** Contenu brut d'une fixture du contrat, par exemple `fixture("ws/server/ack.json")`. */
fun fixture(path: String): String = File(fixturesDir, path).readText()

/**
 * Faux transport (Seam 3) : rejoue les fixtures, enregistre les requêtes HTTP et les
 * messages émis sur chaque socket. Les sockets s'ouvrent dans l'ordre des connexions.
 */
class FakeTransport : LiveTransport {
    val requests = mutableListOf<HttpRequest>()
    val sockets = mutableListOf<FakeSocket>()
    val connectedUrls = mutableListOf<String>()

    /** Nombre de prochaines connexions WebSocket refusées (réseau coupé). */
    var refuseConnections = 0

    var http: (HttpRequest) -> HttpResponse = { request ->
        when {
            request.url.endsWith("/v1/config") -> HttpResponse(200, mapOf("ETag" to "\"v1\""), fixture("config.json"))
            request.url.endsWith("/v1/lives") && request.method == "GET" ->
                HttpResponse(200, emptyMap(), fixture("http/lives.list.response.json"))
            request.url.endsWith("/v1/lives") && request.method == "POST" ->
                HttpResponse(201, emptyMap(), fixture("http/lives.create.response.json"))
            else -> HttpResponse(404, emptyMap(), fixture("http/error.not_found.json"))
        }
    }

    override suspend fun request(request: HttpRequest): HttpResponse {
        requests += request
        return http(request)
    }

    override suspend fun connect(url: String): WebSocketConnection {
        connectedUrls += url
        if (refuseConnections > 0) {
            refuseConnections--
            throw IOException("connexion refusée")
        }
        return FakeSocket().also { sockets += it }
    }

    val socket: FakeSocket get() = sockets.last()

    fun configRequests(): List<HttpRequest> = requests.filter { it.url.endsWith("/v1/config") }
}

class FakeSocket : WebSocketConnection {
    private val incoming = Channel<String>(Channel.UNLIMITED)
    val sent = mutableListOf<JsonObject>()
    var closedByClient = false
        private set

    /** Le serveur envoie un message. */
    fun push(text: String) {
        incoming.trySend(text)
    }

    /** Le serveur (ou le réseau) ferme le socket. */
    fun drop() {
        incoming.close()
    }

    fun lastSent(type: String): JsonObject = sent.last { it["type"]!!.jsonPrimitive.content == type }

    override suspend fun receive(): String? = incoming.receiveCatching().getOrNull()

    override fun send(text: String) {
        sent += Json.parseToJsonElement(text).jsonObject
    }

    override fun close() {
        closedByClient = true
        incoming.close()
    }
}
