package fr.echimine.live.core

import fr.echimine.live.core.protocol.ClientMessage
import fr.echimine.live.core.protocol.Command
import fr.echimine.live.core.protocol.ServerMessage
import fr.echimine.live.core.protocol.Wire
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeMark
import kotlin.time.TimeSource

/** État observable d'un Live ouvert. */
public data class LiveState(
    val connection: Connection,
    /** `null` tant que le premier `snapshot` n'est pas arrivé. */
    val live: LiveDetails? = null,
    /** `true` après un `rate_limited` du chat, le temps indiqué par le serveur : afficher « Doucement… ». */
    val chatLocked: Boolean = false,
) {
    public sealed interface Connection {
        /** Première connexion en cours. */
        public data object Connecting : Connection

        public data object Connected : Connection

        /** Connexion perdue : nouvelle tentative avec un jeton frais, puis rattrapage par `snapshot`. */
        public data class Reconnecting(val attempt: Int, val lastError: LiveError) : Connection

        public data class Ended(val reason: EndReason, val summary: LiveEndSummary?) : Connection

        /** Ce Participant a ouvert le même Live ailleurs : ce socket est remplacé, sans reconnexion. */
        public data object Replaced : Connection

        /** Bannissement : définitif pour ce Live. */
        public data object Banned : Connection

        /** Le serveur commun refuse d'ouvrir ce Live (inexistant, terminé, Participant banni…). */
        public data class Failed(val error: LiveError) : Connection

        /** Le Live a été fermé par l'App membre. */
        public data object Closed : Connection
    }

    public enum class EndReason(internal val wire: String?) {
        EndedByHost("endedByHost"),
        HostTimeout("hostTimeout"),

        /** Raison que cette version du SDK ne connaît pas. */
        Unknown(null),
        ;

        internal companion object {
            fun fromWire(reason: String): EndReason = entries.firstOrNull { it.wire == reason } ?: Unknown
        }
    }
}

/** Contenu d'un Live, à jour après chaque `snapshot` et chaque événement. */
public data class LiveDetails(
    val id: String,
    val title: String?,
    val startedAt: Instant,
    val you: Participant,
    val role: Role,
    val host: Participant,
    /** `false` pendant le Délai de grâce de l'Hôte. */
    val hostConnected: Boolean,
    /** Par ordre de montée. */
    val cohosts: List<Participant>,
    val pinnedProduct: Product?,
    val audience: Audience,
    val reactionsTotal: Int,
    /** Les derniers messages du chat, du plus ancien au plus récent. */
    val messages: List<ChatMessage>,
    /** Demandes de montée en attente : renseignées pour l'Hôte seul. */
    val joinRequests: List<Participant>,
    /** Shadowbans et Bannissements : pour les Animateurs seuls. */
    val moderation: Moderation?,
    /**
     * Spectateur : sa propre Demande de montée est en attente, jusqu'à son annulation, sa montée, son refus
     * ([LiveEvent.JoinDeclined]) ou une reconnexion (qui l'efface).
     */
    val requestedToJoin: Boolean = false,
) {
    /** Les personnes à l'écran, dans l'ordre de la mosaïque : l'Hôte, puis les Co-hôtes par ordre de montée. */
    public val stage: List<Participant> get() = listOf(host) + cohosts
}

/** Événements ponctuels, à animer plutôt qu'à afficher en continu. */
public sealed interface LiveEvent {
    /**
     * Réactions à animer, par emoji : celles de tous sur la dernière fenêtre du serveur (500 ms),
     * et la sienne aussitôt envoyée (retirée de la fenêtre suivante, pour ne pas l'animer deux fois).
     */
    public data class ReactionsReceived(val counts: Map<String, Int>) : LiveEvent

    /** Une Annonce d'achat vient d'arriver dans le chat. */
    public data class PurchaseAnnounced(val message: ChatMessage.Purchase) : LiveEvent

    /** Spectateur : l'Hôte a refusé sa Demande de montée (`requestedToJoin` repasse à `false`). */
    public data object JoinDeclined : LiveEvent
}

/**
 * Un Live ouvert : un WebSocket vers le serveur commun, reconnecté automatiquement
 * (backoff exponentiel plafonné à 10 s, jeton frais à chaque tentative).
 */
public class Live internal constructor(
    public val id: String,
    private val url: String,
    private val tokenProvider: TokenProvider,
    private val transport: LiveTransport,
    configFlow: StateFlow<LiveConfig>,
    parent: CoroutineScope,
    dispatcher: CoroutineDispatcher,
    private val timeSource: TimeSource,
    private val uploadImage: suspend (ByteArray) -> LiveResult<String>,
) {
    private val scope = CoroutineScope(SupervisorJob(parent.coroutineContext[Job]) + dispatcher)
    private val stateFlow = MutableStateFlow(LiveState(LiveState.Connection.Connecting))
    private val eventFlow = MutableSharedFlow<LiveEvent>(extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    private val pending = ConcurrentHashMap<String, CompletableDeferred<LiveResult<Unit>>>()
    private val refs = AtomicInteger()

    /**
     * Ses Réactions déjà animées localement, pas encore retrouvées dans une fenêtre du serveur :
     * envoyées depuis la dernière fenêtre, et reportées de la précédente (oubliées ensuite).
     */
    private val ownReactionsLock = Any()
    private var ownSinceLastWindow = mutableMapOf<String, Int>()
    private var ownCarried = mutableMapOf<String, Int>()

    @Volatile
    private var activeSocket: WebSocketConnection? = null

    /** Fin du verrou du chat posé par le dernier `rate_limited` ; gardés par [chatLock]. */
    private val chatLock = Any()
    private var chatUnlockAt: TimeMark? = null
    private var chatUnlockJob: Job? = null

    public val state: StateFlow<LiveState> = stateFlow.asStateFlow()

    /** Config commune, à jour après chaque rechargement : jeu de Réactions, longueur maximale du chat… */
    public val config: StateFlow<LiveConfig> = configFlow
    public val events: SharedFlow<LiveEvent> = eventFlow.asSharedFlow()

    @OptIn(InternalLiveSdkApi::class)
    private val mediaFlow = MutableStateFlow<MediaAccess?>(null)

    /** Accès média du dernier `snapshot`, `null` avant le premier. */
    @InternalLiveSdkApi
    public val media: StateFlow<MediaAccess?> = mediaFlow.asStateFlow()

    internal fun start() {
        scope.launch { run() }
    }

    /** Quitte le Live. */
    public fun close() {
        scope.cancel()
        stateFlow.update { state ->
            when (state.connection) {
                LiveState.Connection.Connecting, LiveState.Connection.Connected, is LiveState.Connection.Reconnecting ->
                    state.copy(connection = LiveState.Connection.Closed)
                else -> state // une fin déjà connue (Live terminé, remplacé, banni…) reste visible
            }
        }
    }

    // ------------------------------------------------------------ commandes

    /** Hôte : termine le Live pour tout le monde. */
    public suspend fun endLive(): LiveResult<Unit> = command { Command.EndLive(it) }

    /**
     * Spectateur : demande à monter (une seule Demande de montée en attente, `requestedToJoin` à l'`ack`).
     * À l'acceptation, la permission de publier s'ouvre sans reconnexion.
     */
    public suspend fun requestToJoin(): LiveResult<Unit> =
        command { Command.RequestToJoin(it) }.onSuccess { setRequestedToJoin(true) }

    public suspend fun cancelJoinRequest(): LiveResult<Unit> =
        command { Command.CancelJoinRequest(it) }.onSuccess { setRequestedToJoin(false) }

    private fun setRequestedToJoin(requested: Boolean) = stateFlow.update { state ->
        val live = state.live ?: return@update state
        // Monté entre-temps : la demande n'existe plus.
        if (requested && live.role != Role.Viewer) return@update state
        state.copy(live = live.copy(requestedToJoin = requested))
    }

    private inline fun LiveResult<Unit>.onSuccess(action: () -> Unit): LiveResult<Unit> =
        also { if (it is LiveResult.Success) action() }

    /** Hôte : accepte une Demande de montée ([MAX_COHOSTS] Co-hôtes au plus, sinon [LiveErrorCode.CohostLimit]). */
    public suspend fun acceptJoin(participantId: String): LiveResult<Unit> =
        command { Command.AcceptJoin(it, participantId) }

    /**
     * Hôte : refuse une Demande de montée, retirée à l'`ack` (le serveur ne prévient que le Spectateur refusé,
     * par `joinDeclined`).
     */
    public suspend fun declineJoin(participantId: String): LiveResult<Unit> =
        command { Command.DeclineJoin(it, participantId) }.onSuccess {
            stateFlow.update { state ->
                val live = state.live ?: return@update state
                state.copy(live = live.copy(joinRequests = live.joinRequests.filterNot { it.id == participantId }))
            }
        }

    /** Co-hôte : redevient Spectateur. */
    public suspend fun leaveStage(): LiveResult<Unit> = command { Command.LeaveStage(it) }

    public suspend fun removeCohost(participantId: String): LiveResult<Unit> =
        command { Command.RemoveCohost(it, participantId) }

    /**
     * Envoie un message, après `trim`. Vide ou au-delà de `config.chatMaxLength` caractères
     * visibles, il est refusé sans rien envoyer ([LiveErrorCode.InvalidMessage]).
     */
    @OptIn(InternalLiveSdkApi::class)
    public suspend fun sendMessage(text: String): LiveResult<Unit> {
        val trimmed = text.trim()
        val max = config.value.chatMaxLength
        if (visibleLength(trimmed) !in 1..max) {
            return LiveResult.Failure(
                LiveError(LiveErrorCode.InvalidMessage, "Un message fait de 1 à $max caractères visibles."),
            )
        }
        val remaining = synchronized(chatLock) { chatUnlockAt }?.let { -it.elapsedNow() }
        if (remaining != null && remaining.isPositive()) {
            return LiveResult.Failure(
                LiveError(LiveErrorCode.RateLimited, "Doucement…", remaining.inWholeMilliseconds.coerceAtLeast(1)),
            )
        }
        val result = command { Command.SendMessage(it, trimmed) }
        if (result is LiveResult.Failure && result.error.code == LiveErrorCode.RateLimited) {
            lockChat((result.error.retryAfterMs ?: DEFAULT_CHAT_LOCK_MS).milliseconds)
        }
        return result
    }

    /** Verrouille le chat pour [duration], puis le rouvre de lui-même. */
    private fun lockChat(duration: Duration) = synchronized(chatLock) {
        if (chatUnlockAt?.let { -it.elapsedNow() > duration } == true) return@synchronized // un verrou plus long court déjà
        val unlockAt = timeSource.markNow() + duration
        chatUnlockAt = unlockAt
        stateFlow.update { it.copy(chatLocked = true) }
        chatUnlockJob?.cancel()
        chatUnlockJob = scope.launch {
            delay(duration)
            synchronized(chatLock) {
                if (chatUnlockAt !== unlockAt) return@launch
                chatUnlockAt = null
                stateFlow.update { it.copy(chatLocked = false) }
            }
        }
    }

    public suspend fun deleteMessage(messageId: String): LiveResult<Unit> =
        command { Command.DeleteMessage(it, messageId) }

    /**
     * Animateur : épingle un produit, ou remplace le Produit épinglé. [price] en centimes,
     * [currency] code ISO 4217. Un produit invalide (nom vide ou au-delà de `config.productNameMaxLength`
     * après `trim`, prix hors de 0 à [MAX_PRODUCT_PRICE], devise mal formée, image non https) est refusé sans rien envoyer
     * ([LiveErrorCode.InvalidProduct]). Une [ProductImage.Data] est d'abord réduite puis envoyée au serveur commun.
     */
    public suspend fun pinProduct(
        name: String,
        price: Int,
        currency: String,
        image: ProductImage? = null,
    ): LiveResult<Unit> {
        val trimmed = name.trim()
        @OptIn(InternalLiveSdkApi::class)
        productProblem(trimmed, price, currency, (image as? ProductImage.Url)?.url, config.value.productNameMaxLength)?.let {
            return LiveResult.Failure(LiveError(LiveErrorCode.InvalidProduct, it))
        }
        val imageUrl = when (image) {
            null -> null
            is ProductImage.Url -> image.url
            is ProductImage.Data -> when (val uploaded = uploadImage(image.bytes)) {
                is LiveResult.Success -> uploaded.value
                is LiveResult.Failure -> return uploaded
            }
        }
        return command { Command.PinProduct(it, trimmed, price, currency, imageUrl) }
    }

    public suspend fun unpinProduct(): LiveResult<Unit> = command { Command.UnpinProduct(it) }

    /** Achète le Produit épinglé ; [LiveErrorCode.ProductChanged] s'il a changé entre-temps. */
    public suspend fun purchase(productId: String): LiveResult<Unit> = command { Command.Purchase(it, productId) }

    public suspend fun shadowban(participantId: String): LiveResult<Unit> =
        command { Command.Shadowban(it, participantId) }

    public suspend fun unshadowban(participantId: String): LiveResult<Unit> =
        command { Command.Unshadowban(it, participantId) }

    /** Bannissement définitif pour ce Live ; un Co-hôte n'est bannissable que par l'Hôte. */
    public suspend fun ban(participantId: String): LiveResult<Unit> = command { Command.Ban(it, participantId) }

    /**
     * Envoie une Réaction, sans accusé de réception, et l'anime aussitôt ([LiveEvent.ReactionsReceived]).
     * Ignorée hors connexion ou si [emoji] n'est pas dans `config.reactions`.
     */
    public fun react(emoji: String) {
        if (emoji !in config.value.reactions) return
        val socket = activeSocket ?: return
        socket.send(Wire.encodeClientMessage(ClientMessage.React(emoji)))
        synchronized(ownReactionsLock) { ownSinceLastWindow.merge(emoji, 1, Int::plus) }
        eventFlow.tryEmit(LiveEvent.ReactionsReceived(mapOf(emoji to 1)))
    }

    /**
     * Retire de [counts] ses propres Réactions déjà animées. Une Réaction envoyée en fin de fenêtre
     * peut n'arriver que dans la suivante : celles qui manquent sont reportées une fois, puis oubliées
     * (Réaction perdue, ou ignorée par le serveur).
     */
    private fun withoutOwnReactions(counts: Map<String, Int>): Map<String, Int> = synchronized(ownReactionsLock) {
        val remaining = counts.toMutableMap()
        fun subtract(own: MutableMap<String, Int>) {
            own.entries.removeAll { entry ->
                val taken = minOf(entry.value, remaining[entry.key] ?: 0)
                remaining[entry.key] = (remaining[entry.key] ?: 0) - taken
                entry.setValue(entry.value - taken)
                entry.value == 0
            }
        }
        subtract(ownCarried)
        subtract(ownSinceLastWindow)
        ownCarried = ownSinceLastWindow
        ownSinceLastWindow = mutableMapOf()
        remaining.filterValues { it > 0 }
    }

    private fun forgetOwnReactions() = synchronized(ownReactionsLock) {
        ownSinceLastWindow.clear()
        ownCarried.clear()
    }

    private suspend fun command(build: (ref: String) -> Command): LiveResult<Unit> {
        val socket = activeSocket ?: return notConnected()
        val ref = "c${refs.incrementAndGet()}"
        val reply = CompletableDeferred<LiveResult<Unit>>()
        pending[ref] = reply
        try {
            // Le socket a pu tomber entre-temps : sa fermeture n'aurait pas vu cette commande.
            if (activeSocket !== socket) return notConnected()
            socket.send(Wire.encodeClientMessage(build(ref)))
            return withTimeoutOrNull(COMMAND_TIMEOUT) { reply.await() }
                ?: LiveResult.Failure(LiveError(LiveErrorCode.Timeout, "Pas de réponse du serveur commun."))
        } finally {
            pending.remove(ref)
        }
    }

    private fun notConnected() =
        LiveResult.Failure(LiveError(LiveErrorCode.NotConnected, "Le Live n'est pas connecté."))

    // ------------------------------------------------------------ connexion

    private sealed interface Outcome {
        /** Fin définitive : pas de reconnexion. */
        data object Stop : Outcome

        data class Retry(val error: LiveError, val caughtUp: Boolean) : Outcome
    }

    private suspend fun run() {
        var attempt = 0
        while (true) {
            when (val outcome = connectOnce()) {
                Outcome.Stop -> return
                is Outcome.Retry -> {
                    if (outcome.caughtUp) attempt = 0
                    attempt++
                    stateFlow.update {
                        it.copy(connection = LiveState.Connection.Reconnecting(attempt, outcome.error))
                    }
                    delay(backoffMs(attempt))
                }
            }
        }
    }

    private suspend fun connectOnce(): Outcome {
        val token = catchingFailures { tokenProvider() }.getOrElse {
            return Outcome.Retry(LiveError(LiveErrorCode.TokenUnavailable, it.message ?: "Jeton indisponible."), false)
        }
        val socket = catchingFailures { transport.connect(url) }.getOrElse {
            return Outcome.Retry(LiveError(LiveErrorCode.Network, it.message ?: "Serveur injoignable."), false)
        }
        var caughtUp = false
        try {
            socket.send(Wire.encodeClientMessage(ClientMessage.Join(token)))
            while (true) {
                val text = socket.receive()
                    ?: return Outcome.Retry(LiveError(LiveErrorCode.Network, "Connexion perdue."), caughtUp)
                when (val message = Wire.decodeServerMessage(text) ?: continue) {
                    is ServerMessage.Snapshot -> {
                        caughtUp = true
                        @OptIn(InternalLiveSdkApi::class)
                        mediaFlow.value = MediaAccess(message.livekit.url, message.livekit.token)
                        val details = message.toDetails()
                        forgetOwnReactions() // fenêtres manquées pendant la coupure
                        stateFlow.update { it.copy(connection = LiveState.Connection.Connected, live = details) }
                        activeSocket = socket
                    }
                    is ServerMessage.Ack -> pending[message.ref]?.complete(LiveResult.Success(Unit))
                    is ServerMessage.Error -> {
                        val error = LiveError(LiveErrorCode.fromWire(message.code), message.message, message.retryAfterMs)
                        val ref = message.ref
                        if (ref != null) {
                            pending[ref]?.complete(LiveResult.Failure(error))
                        } else if (!caughtUp) {
                            // Refus du `join` : définitif si le Live ou le Participant est en cause.
                            if (error.code in FATAL_JOIN_ERRORS) {
                                finish(LiveState.Connection.Failed(error))
                                return Outcome.Stop
                            }
                            return Outcome.Retry(error, false)
                        }
                    }
                    ServerMessage.Replaced -> {
                        finish(LiveState.Connection.Replaced)
                        return Outcome.Stop
                    }
                    ServerMessage.Banned -> {
                        finish(LiveState.Connection.Banned)
                        return Outcome.Stop
                    }
                    is ServerMessage.LiveEnded -> {
                        val reason = LiveState.EndReason.fromWire(message.reason)
                        val summary = message.summary?.let { LiveEndSummary(it.purchases, it.reactions, it.peakAudience) }
                        finish(LiveState.Connection.Ended(reason, summary))
                        return Outcome.Stop
                    }
                    else -> apply(message)
                }
            }
        } finally {
            activeSocket = null
            socket.close()
            val error = LiveError(LiveErrorCode.NotConnected, "Connexion perdue avant la réponse.")
            pending.values.forEach { it.complete(LiveResult.Failure(error)) }
        }
    }

    private fun finish(connection: LiveState.Connection) {
        stateFlow.update { it.copy(connection = connection) }
    }

    /** Applique un événement incrémental à l'état exposé. */
    private fun apply(message: ServerMessage) {
        when (message) {
            is ServerMessage.Reactions -> withoutOwnReactions(message.counts)
                .takeIf { it.isNotEmpty() }
                ?.let { eventFlow.tryEmit(LiveEvent.ReactionsReceived(it)) }
            is ServerMessage.ChatMessageReceived -> (message.message as? ChatMessage.Purchase)
                ?.let { eventFlow.tryEmit(LiveEvent.PurchaseAnnounced(it)) }
            ServerMessage.JoinDeclined -> eventFlow.tryEmit(LiveEvent.JoinDeclined)
            else -> Unit
        }
        stateFlow.update { state ->
            val live = state.live ?: return@update state
            state.copy(live = live.applying(message))
        }
    }

    private fun LiveDetails.applying(message: ServerMessage): LiveDetails = when (message) {
        ServerMessage.HostDisconnected -> copy(hostConnected = false)
        ServerMessage.HostReconnected -> copy(hostConnected = true)
        is ServerMessage.JoinRequested ->
            if (joinRequests.any { it.id == message.participant.id }) this
            else copy(joinRequests = joinRequests + message.participant)
        is ServerMessage.JoinRequestCancelled -> copy(joinRequests = joinRequests.filterNot { it.id == message.participantId })
        ServerMessage.JoinDeclined -> copy(requestedToJoin = false)
        is ServerMessage.RoleChanged -> {
            val participant = message.participant
            val others = cohosts.filterNot { it.id == participant.id }
            val isYou = participant.id == you.id
            val newRole = if (isYou) message.role else role
            copy(
                role = newRole,
                cohosts = if (message.role == Role.Cohost) others + participant else others,
                joinRequests = joinRequests.filterNot { it.id == participant.id },
                moderation = moderation.takeIf { newRole.isAnimator },
                requestedToJoin = requestedToJoin && !isYou,
            )
        }
        is ServerMessage.AudienceChanged -> copy(audience = Audience(message.total, message.byApp))
        is ServerMessage.Reactions -> copy(reactionsTotal = message.total)
        is ServerMessage.ChatMessageReceived ->
            if (messages.any { it.id == message.message.id }) this
            else copy(messages = (messages + message.message).takeLast(MAX_MESSAGES))
        is ServerMessage.MessageDeleted -> copy(messages = messages.filterNot { it.id == message.messageId })
        is ServerMessage.ProductPinned -> copy(pinnedProduct = message.product)
        ServerMessage.ProductUnpinned -> copy(pinnedProduct = null)
        is ServerMessage.ModerationChanged -> copy(moderation = Moderation(message.shadowbanned, message.banned))
        else -> this
    }

    private fun ServerMessage.Snapshot.toDetails() = LiveDetails(
        id = live.id,
        title = live.title,
        startedAt = live.startedAt,
        you = you,
        role = role,
        host = host,
        hostConnected = hostConnected,
        cohosts = cohosts,
        pinnedProduct = pinnedProduct,
        audience = audience,
        reactionsTotal = reactionsTotal,
        messages = messages,
        joinRequests = joinRequests.orEmpty(),
        moderation = moderation?.let { Moderation(it.shadowbanned, it.banned) },
    )

    private companion object {
        val COMMAND_TIMEOUT = 10.seconds
        const val MAX_MESSAGES = 200

        /** Verrou du chat si un `rate_limited` arrive sans `retryAfterMs`. */
        const val DEFAULT_CHAT_LOCK_MS = 5_000L
        const val MAX_BACKOFF_MS = 10_000L
        val FATAL_JOIN_ERRORS = setOf(LiveErrorCode.LiveNotFound, LiveErrorCode.Banned, LiveErrorCode.NotFound)

        /** 1 s, 2 s, 4 s, 8 s puis 10 s. */
        fun backoffMs(attempt: Int): Long = minOf(1000L shl minOf(attempt - 1, 10), MAX_BACKOFF_MS)
    }
}
