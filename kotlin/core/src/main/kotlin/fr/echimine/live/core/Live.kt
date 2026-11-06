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
import kotlin.time.Duration.Companion.seconds

/** État observable d'un Live ouvert. */
public data class LiveState(
    val connection: Connection,
    /** `null` tant que le premier `snapshot` n'est pas arrivé. */
    val live: LiveDetails? = null,
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
)

/** Événements ponctuels, à animer plutôt qu'à afficher en continu. */
public sealed interface LiveEvent {
    /** Réactions reçues sur la dernière fenêtre (500 ms), par emoji. */
    public data class ReactionsReceived(val counts: Map<String, Int>) : LiveEvent

    /** Une Annonce d'achat vient d'arriver dans le chat. */
    public data class PurchaseAnnounced(val message: ChatMessage.Purchase) : LiveEvent
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
    parent: CoroutineScope,
    dispatcher: CoroutineDispatcher,
) {
    private val scope = CoroutineScope(SupervisorJob(parent.coroutineContext[Job]) + dispatcher)
    private val stateFlow = MutableStateFlow(LiveState(LiveState.Connection.Connecting))
    private val eventFlow = MutableSharedFlow<LiveEvent>(extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    private val pending = ConcurrentHashMap<String, CompletableDeferred<LiveResult<Unit>>>()
    private val refs = AtomicInteger()

    @Volatile
    private var activeSocket: WebSocketConnection? = null

    public val state: StateFlow<LiveState> = stateFlow.asStateFlow()
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

    /** Spectateur : demande à monter (une seule Demande de montée en attente). */
    public suspend fun requestToJoin(): LiveResult<Unit> = command { Command.RequestToJoin(it) }

    public suspend fun cancelJoinRequest(): LiveResult<Unit> = command { Command.CancelJoinRequest(it) }

    /** Hôte : accepte une Demande de montée (5 Co-hôtes au plus). */
    public suspend fun acceptJoin(participantId: String): LiveResult<Unit> =
        command { Command.AcceptJoin(it, participantId) }

    public suspend fun declineJoin(participantId: String): LiveResult<Unit> =
        command { Command.DeclineJoin(it, participantId) }

    /** Co-hôte : redevient Spectateur. */
    public suspend fun leaveStage(): LiveResult<Unit> = command { Command.LeaveStage(it) }

    public suspend fun removeCohost(participantId: String): LiveResult<Unit> =
        command { Command.RemoveCohost(it, participantId) }

    /** Envoie un message (1 à `config.chatMaxLength` caractères visibles après `trim`). */
    public suspend fun sendMessage(text: String): LiveResult<Unit> = command { Command.SendMessage(it, text) }

    public suspend fun deleteMessage(messageId: String): LiveResult<Unit> =
        command { Command.DeleteMessage(it, messageId) }

    /** Animateur : épingle un produit. [price] en centimes, [currency] ISO 4217, [imageUrl] https. */
    public suspend fun pinProduct(
        name: String,
        price: Int,
        currency: String,
        imageUrl: String? = null,
    ): LiveResult<Unit> = command { Command.PinProduct(it, name, price, currency, imageUrl) }

    public suspend fun unpinProduct(): LiveResult<Unit> = command { Command.UnpinProduct(it) }

    /** Achète le Produit épinglé ; [LiveErrorCode.ProductChanged] s'il a changé entre-temps. */
    public suspend fun purchase(productId: String): LiveResult<Unit> = command { Command.Purchase(it, productId) }

    public suspend fun shadowban(participantId: String): LiveResult<Unit> =
        command { Command.Shadowban(it, participantId) }

    public suspend fun unshadowban(participantId: String): LiveResult<Unit> =
        command { Command.Unshadowban(it, participantId) }

    /** Bannissement définitif pour ce Live ; un Co-hôte n'est bannissable que par l'Hôte. */
    public suspend fun ban(participantId: String): LiveResult<Unit> = command { Command.Ban(it, participantId) }

    /** Envoie une Réaction, sans accusé de réception ; ignorée hors connexion. */
    public fun react(emoji: String) {
        activeSocket?.send(Wire.encodeClientMessage(ClientMessage.React(emoji)))
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
                        stateFlow.value = LiveState(LiveState.Connection.Connected, message.toDetails())
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
            is ServerMessage.Reactions -> eventFlow.tryEmit(LiveEvent.ReactionsReceived(message.counts))
            is ServerMessage.ChatMessageReceived -> (message.message as? ChatMessage.Purchase)
                ?.let { eventFlow.tryEmit(LiveEvent.PurchaseAnnounced(it)) }
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
        const val MAX_BACKOFF_MS = 10_000L
        val FATAL_JOIN_ERRORS = setOf(LiveErrorCode.LiveNotFound, LiveErrorCode.Banned, LiveErrorCode.NotFound)

        /** 1 s, 2 s, 4 s, 8 s puis 10 s. */
        fun backoffMs(attempt: Int): Long = minOf(1000L shl minOf(attempt - 1, 10), MAX_BACKOFF_MS)
    }
}
