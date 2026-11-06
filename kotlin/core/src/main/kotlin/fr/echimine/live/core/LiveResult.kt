package fr.echimine.live.core

/** Issue d'une commande ou d'une requête : succès, ou erreur à code fermé. */
public sealed interface LiveResult<out T> {
    public data class Success<out T>(val value: T) : LiveResult<T>

    public data class Failure(val error: LiveError) : LiveResult<Nothing>
}

public data class LiveError(
    val code: LiveErrorCode,
    val message: String,
    /** Délai avant de réessayer, avec [LiveErrorCode.RateLimited] seulement. */
    val retryAfterMs: Long? = null,
)

/** Codes d'erreur fermés : ceux du serveur commun, plus ceux du SDK lui-même. */
public enum class LiveErrorCode(internal val wire: String?) {
    // Serveur commun (WebSocket et HTTP).
    InvalidToken("invalid_token"),
    LiveNotFound("live_not_found"),
    Banned("banned"),
    NotHost("not_host"),
    NotAnimator("not_animator"),
    CohostLimit("cohost_limit"),
    RateLimited("rate_limited"),
    ProductChanged("product_changed"),
    InvalidMessage("invalid_message"),
    InvalidProduct("invalid_product"),
    InvalidCommand("invalid_command"),
    UnknownCommand("unknown_command"),
    NotFound("not_found"),
    InvalidRequest("invalid_request"),
    PayloadTooLarge("payload_too_large"),
    UnsupportedMediaType("unsupported_media_type"),

    // SDK.
    /** Le Live n'est pas connecté (connexion en cours, reconnexion ou Live quitté). */
    NotConnected(null),

    /** Pas de réponse du serveur à temps. */
    Timeout(null),

    /** Serveur injoignable. */
    Network(null),

    /** Le `tokenProvider` de l'App membre a échoué. */
    TokenUnavailable(null),

    /** Code ou réponse que cette version du SDK ne connaît pas. */
    Unknown(null),
    ;

    internal companion object {
        private val byWire = entries.filter { it.wire != null }.associateBy { it.wire }

        fun fromWire(code: String): LiveErrorCode = byWire[code] ?: Unknown
    }
}
