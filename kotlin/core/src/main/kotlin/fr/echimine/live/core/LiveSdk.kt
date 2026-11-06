package fr.echimine.live.core

import fr.echimine.live.core.protocol.HttpErrorBody
import fr.echimine.live.core.protocol.LivesCreateRequest
import fr.echimine.live.core.protocol.LivesCreateResponse
import fr.echimine.live.core.protocol.LivesListResponse
import fr.echimine.live.core.protocol.Wire
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerializationException
import java.net.URLEncoder
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeMark
import kotlin.time.TimeSource

/**
 * Fournit un Jeton de Participant frais, signé par le backend de l'App membre
 * (`POST /live/participant-token`). Appelé à chaque connexion et reconnexion.
 */
public typealias TokenProvider = suspend () -> String

/**
 * Exécute [block] en capturant ses échecs, sauf l'annulation de la coroutine, qui se propage.
 */
internal suspend inline fun <T> catchingFailures(block: suspend () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }

/** Point d'entrée du cœur du SDK Live. */
public object LiveSdk {
    @Volatile
    private var current: LiveClient? = null

    /** Le client du dernier [configure]. */
    public val client: LiveClient
        get() = checkNotNull(current) { "LiveSdk.configure(...) doit être appelé d'abord." }

    /**
     * Configure le SDK : [serverUrl] est l'URL du serveur commun (`https://live.echimine.fr`).
     * Charge la config commune en arrière-plan. Un nouvel appel ferme le client précédent.
     */
    public fun configure(
        serverUrl: String,
        tokenProvider: TokenProvider,
        transport: LiveTransport = OkHttpLiveTransport(),
    ): LiveClient = configure(serverUrl, tokenProvider, transport, Dispatchers.Default, TimeSource.Monotonic)

    /** Variante des tests : temps et coroutines virtuels. */
    internal fun configure(
        serverUrl: String,
        tokenProvider: TokenProvider,
        transport: LiveTransport,
        dispatcher: CoroutineDispatcher,
        timeSource: TimeSource,
    ): LiveClient {
        val client = LiveClient(serverUrl, tokenProvider, transport, dispatcher, timeSource)
        synchronized(this) {
            current?.close()
            current = client
        }
        return client
    }
}

/** Accès au serveur commun pour une App membre configurée : liste, lancement et ouverture des Lives. */
public class LiveClient internal constructor(
    serverUrl: String,
    private val tokenProvider: TokenProvider,
    private val transport: LiveTransport,
    private val dispatcher: CoroutineDispatcher,
    private val timeSource: TimeSource,
) {
    private val baseUrl = serverUrl.trimEnd('/')
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)

    private val configState = MutableStateFlow(LiveConfig.Defaults)
    private val configMutex = Mutex()
    private var configETag: String? = null
    private var configFetchedAt: TimeMark? = null

    /** Config commune : valeurs par défaut embarquées jusqu'au premier chargement réussi. */
    public val config: StateFlow<LiveConfig> = configState.asStateFlow()

    init {
        scope.launch { refreshConfigIfStale() }
    }

    /** Lives en cours de toutes les App membres, triés par Audience décroissante. */
    public suspend fun lives(): LiveResult<List<LiveSummary>> =
        http("GET", "/v1/lives", null, LivesListResponse.serializer()).map { it.lives }

    /**
     * Lance un Live (ou rend celui déjà en cours de cet Hôte) puis l'ouvre.
     * [title] : 80 caractères au plus.
     */
    public suspend fun startLive(title: String? = null): LiveResult<Live> {
        val body = Wire.json.encodeToString(LivesCreateRequest.serializer(), LivesCreateRequest(title))
        return http("POST", "/v1/lives", body, LivesCreateResponse.serializer()).map { openLive(it.live.id) }
    }

    /**
     * Ouvre un Live par son identifiant. La connexion se fait en arrière-plan ;
     * suivre [Live.state]. La config est rechargée d'abord si elle date de plus de 5 min.
     */
    public suspend fun openLive(id: String): Live {
        withTimeoutOrNull(CONFIG_WAIT) { refreshConfigIfStale() }
        val path = URLEncoder.encode(id, "UTF-8").replace("+", "%20")
        val wsUrl = webSocketBase() + "/v1/lives/$path/ws"
        return Live(id, wsUrl, tokenProvider, transport, scope, dispatcher).also { it.start() }
    }

    /** Ferme le client et tous les Lives qu'il a ouverts. */
    public fun close() {
        scope.cancel()
    }

    private fun webSocketBase(): String = when {
        baseUrl.startsWith("https://") -> "wss://" + baseUrl.removePrefix("https://")
        baseUrl.startsWith("http://") -> "ws://" + baseUrl.removePrefix("http://")
        else -> baseUrl
    }

    // ------------------------------------------------------------ config

    private suspend fun refreshConfigIfStale() = configMutex.withLock {
        val fetchedAt = configFetchedAt
        if (fetchedAt != null && fetchedAt.elapsedNow() < CONFIG_MAX_AGE) return@withLock
        val headers = authorization() ?: return@withLock
        val request = HttpRequest(
            "GET",
            "$baseUrl/v1/config",
            headers + listOfNotNull(configETag?.let { "If-None-Match" to it }),
        )
        // Hors ligne ou réponse illisible : on garde le cache, ou les valeurs par défaut.
        val response = catchingFailures { transport.request(request) }.getOrNull() ?: return@withLock
        when (response.status) {
            200 -> {
                configState.value = Wire.decodeConfig(response.body) ?: return@withLock
                configETag = response.header("ETag")
                configFetchedAt = timeSource.markNow()
            }
            304 -> configFetchedAt = timeSource.markNow()
        }
    }

    // ------------------------------------------------------------ HTTP

    private suspend fun authorization(): Map<String, String>? =
        catchingFailures { mapOf("Authorization" to "Bearer ${tokenProvider()}") }.getOrNull()

    private suspend fun <T> http(
        method: String,
        path: String,
        body: String?,
        deserializer: DeserializationStrategy<T>,
    ): LiveResult<T> {
        val auth = authorization()
            ?: return failure(LiveErrorCode.TokenUnavailable, "Le Jeton de Participant n'a pas pu être obtenu.")
        val headers = if (body != null) auth + ("Content-Type" to "application/json") else auth
        val response = catchingFailures { transport.request(HttpRequest(method, baseUrl + path, headers, body)) }
            .getOrElse { return failure(LiveErrorCode.Network, it.message ?: "Serveur injoignable.") }
        if (response.status !in 200..299) return LiveResult.Failure(httpError(response))
        return try {
            LiveResult.Success(Wire.json.decodeFromString(deserializer, response.body))
        } catch (_: SerializationException) {
            failure(LiveErrorCode.Unknown, "Réponse illisible du serveur commun.")
        } catch (_: IllegalArgumentException) {
            failure(LiveErrorCode.Unknown, "Réponse illisible du serveur commun.")
        }
    }

    private fun httpError(response: HttpResponse): LiveError {
        val retryAfterMs = response.header("Retry-After")?.trim()?.toLongOrNull()?.times(1000)
        val body = try {
            Wire.json.decodeFromString(HttpErrorBody.serializer(), response.body).error
        } catch (_: Exception) {
            null
        }
        val code = body?.let { LiveErrorCode.fromWire(it.code) } ?: when (response.status) {
            401 -> LiveErrorCode.InvalidToken
            404 -> LiveErrorCode.NotFound
            413 -> LiveErrorCode.PayloadTooLarge
            415 -> LiveErrorCode.UnsupportedMediaType
            429 -> LiveErrorCode.RateLimited
            else -> LiveErrorCode.Unknown
        }
        return LiveError(
            code = code,
            message = body?.message ?: "Erreur HTTP ${response.status}.",
            retryAfterMs = retryAfterMs.takeIf { code == LiveErrorCode.RateLimited },
        )
    }

    private fun failure(code: LiveErrorCode, message: String) = LiveResult.Failure(LiveError(code, message))

    private inline fun <T, R> LiveResult<T>.map(transform: (T) -> R): LiveResult<R> = when (this) {
        is LiveResult.Success -> LiveResult.Success(transform(value))
        is LiveResult.Failure -> this
    }

    private companion object {
        val CONFIG_MAX_AGE = 5.minutes
        val CONFIG_WAIT = 5.seconds
    }
}
