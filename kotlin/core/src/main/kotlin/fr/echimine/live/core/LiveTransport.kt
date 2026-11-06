package fr.echimine.live.core

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Headers.Companion.toHeaders
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Accès réseau du SDK vers le serveur commun : requêtes HTTP `/v1/` et WebSocket du Live.
 * Injectable pour les tests ; par défaut, OkHttp.
 */
public interface LiveTransport {
    /** Lève une [IOException] si le serveur est injoignable ; un statut d'erreur n'est pas une exception. */
    public suspend fun request(request: HttpRequest): HttpResponse

    /** Ouvre un WebSocket ; lève une [IOException] si la connexion échoue. */
    public suspend fun connect(url: String): WebSocketConnection
}

public data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    /** Corps JSON. */
    val body: String? = null,
    /** Corps binaire (image), du type donné par l'en-tête `Content-Type` ; exclusif de [body]. */
    val bytes: ByteArray? = null,
)

public data class HttpResponse(
    val status: Int,
    val headers: Map<String, String> = emptyMap(),
    val body: String = "",
) {
    /** Valeur d'un en-tête, sans tenir compte de la casse de son nom. */
    public fun header(name: String): String? =
        headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
}

/** Un WebSocket ouvert. */
public interface WebSocketConnection {
    /** Prochain message texte, ou `null` une fois le socket fermé. */
    public suspend fun receive(): String?

    public fun send(text: String)

    public fun close()
}

/** Transport de production, sur OkHttp. */
internal class OkHttpLiveTransport(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build(),
) : LiveTransport {
    private val json = "application/json; charset=utf-8".toMediaType()

    override suspend fun request(request: HttpRequest): HttpResponse = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(
            Request.Builder()
                .url(request.url)
                .headers(request.headers.toHeaders())
                .method(
                    request.method,
                    request.bytes?.toRequestBody(request.headers.entries.firstOrNull { it.key.equals("Content-Type", true) }?.value?.toMediaType())
                        ?: request.body?.toRequestBody(json),
                )
                .build(),
        )
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = continuation.resumeWithException(e)

            override fun onResponse(call: Call, response: Response) {
                val result = response.use {
                    try {
                        HttpResponse(it.code, it.headers.toMap(), it.body?.string().orEmpty())
                    } catch (e: IOException) {
                        continuation.resumeWithException(e)
                        return
                    }
                }
                continuation.resume(result)
            }
        })
    }

    override suspend fun connect(url: String): WebSocketConnection = suspendCancellableCoroutine { continuation ->
        val incoming = Channel<String>(Channel.UNLIMITED)
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                continuation.resume(OkHttpConnection(webSocket, incoming))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                incoming.trySend(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                incoming.close()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                incoming.close()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                incoming.close()
                if (continuation.isActive) continuation.resumeWithException(IOException(t))
            }
        }
        val webSocket = client.newWebSocket(Request.Builder().url(url).build(), listener)
        continuation.invokeOnCancellation { webSocket.cancel() }
    }

    private class OkHttpConnection(
        private val webSocket: WebSocket,
        private val incoming: Channel<String>,
    ) : WebSocketConnection {
        override suspend fun receive(): String? = incoming.receiveCatching().getOrNull()

        override fun send(text: String) {
            webSocket.send(text)
        }

        override fun close() {
            webSocket.close(1000, null)
            incoming.close()
        }
    }
}
