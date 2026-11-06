package fr.echimine.live.core.protocol

import fr.echimine.live.core.Audience
import fr.echimine.live.core.ChatMessage
import fr.echimine.live.core.LiveSummary
import fr.echimine.live.core.Participant
import fr.echimine.live.core.Product
import fr.echimine.live.core.Role
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

/*
 * Protocole WebSocket du Live (`/v1/lives/{id}/ws`), écrit à la main d'après
 * `protocol/fixtures/` (ADR 0001) : enveloppe JSON discriminée par `type`.
 */

// ---------------------------------------------------------------- serveur → SDK

@Serializable
internal sealed interface ServerMessage {
    @Serializable @SerialName("ack")
    data class Ack(val ref: String) : ServerMessage

    /** [code] reste une chaîne : un code inconnu ne doit pas rendre le message illisible. */
    @Serializable @SerialName("error")
    data class Error(
        val ref: String? = null,
        val code: String,
        val message: String,
        val retryAfterMs: Long? = null,
    ) : ServerMessage

    @Serializable @SerialName("snapshot")
    data class Snapshot(
        val live: LiveInfo,
        val you: Participant,
        val role: Role,
        val host: Participant,
        val hostConnected: Boolean,
        val cohosts: List<Participant>,
        val pinnedProduct: Product? = null,
        val audience: Audience,
        val reactionsTotal: Int,
        val messages: List<ChatMessage>,
        val livekit: LiveKitCredentials,
        val joinRequests: List<Participant>? = null,
        val moderation: ModerationLists? = null,
    ) : ServerMessage

    @Serializable @SerialName("replaced")
    data object Replaced : ServerMessage

    @Serializable @SerialName("hostDisconnected")
    data object HostDisconnected : ServerMessage

    @Serializable @SerialName("hostReconnected")
    data object HostReconnected : ServerMessage

    /** [reason] : `endedByHost` ou `hostTimeout`, gardé en chaîne pour ne jamais perdre la fin. */
    @Serializable @SerialName("liveEnded")
    data class LiveEnded(val reason: String, val summary: EndSummary? = null) : ServerMessage

    @Serializable @SerialName("joinRequested")
    data class JoinRequested(val participant: Participant) : ServerMessage

    @Serializable @SerialName("joinRequestCancelled")
    data class JoinRequestCancelled(val participantId: String) : ServerMessage

    @Serializable @SerialName("roleChanged")
    data class RoleChanged(val participant: Participant, val role: Role) : ServerMessage

    @Serializable @SerialName("audience")
    data class AudienceChanged(val total: Int, val byApp: Map<String, Int>) : ServerMessage

    @Serializable @SerialName("reactions")
    data class Reactions(val counts: Map<String, Int>, val total: Int) : ServerMessage

    @Serializable @SerialName("chatMessage")
    data class ChatMessageReceived(val message: ChatMessage) : ServerMessage

    @Serializable @SerialName("messageDeleted")
    data class MessageDeleted(val messageId: String) : ServerMessage

    @Serializable @SerialName("productPinned")
    data class ProductPinned(val product: Product) : ServerMessage

    @Serializable @SerialName("productUnpinned")
    data object ProductUnpinned : ServerMessage

    @Serializable @SerialName("banned")
    data object Banned : ServerMessage

    @Serializable @SerialName("moderationChanged")
    data class ModerationChanged(
        val shadowbanned: List<Participant>,
        val banned: List<Participant>,
    ) : ServerMessage
}

@Serializable
internal data class LiveInfo(
    val id: String,
    val title: String? = null,
    @Serializable(with = InstantSerializer::class) val startedAt: Instant,
)

@Serializable
internal data class LiveKitCredentials(val url: String, val token: String)

@Serializable
internal data class ModerationLists(val shadowbanned: List<Participant>, val banned: List<Participant>)

@Serializable
internal data class EndSummary(val purchases: Int, val reactions: Int, val peakAudience: Int)

// ---------------------------------------------------------------- SDK → serveur

@Serializable
internal sealed interface ClientMessage {
    @Serializable @SerialName("join")
    data class Join(val token: String) : ClientMessage

    @Serializable @SerialName("react")
    data class React(val emoji: String) : ClientMessage
}

/** Commande portant un `ref`, à laquelle le serveur répond par `ack` ou `error`. */
@Serializable
internal sealed interface Command : ClientMessage {
    val ref: String

    @Serializable @SerialName("endLive")
    data class EndLive(override val ref: String) : Command

    @Serializable @SerialName("requestToJoin")
    data class RequestToJoin(override val ref: String) : Command

    @Serializable @SerialName("cancelJoinRequest")
    data class CancelJoinRequest(override val ref: String) : Command

    @Serializable @SerialName("acceptJoin")
    data class AcceptJoin(override val ref: String, val participantId: String) : Command

    @Serializable @SerialName("declineJoin")
    data class DeclineJoin(override val ref: String, val participantId: String) : Command

    @Serializable @SerialName("leaveStage")
    data class LeaveStage(override val ref: String) : Command

    @Serializable @SerialName("removeCohost")
    data class RemoveCohost(override val ref: String, val participantId: String) : Command

    @Serializable @SerialName("sendMessage")
    data class SendMessage(override val ref: String, val text: String) : Command

    @Serializable @SerialName("deleteMessage")
    data class DeleteMessage(override val ref: String, val messageId: String) : Command

    @Serializable @SerialName("pinProduct")
    data class PinProduct(
        override val ref: String,
        val name: String,
        val price: Int,
        val currency: String,
        val imageUrl: String? = null,
    ) : Command

    @Serializable @SerialName("unpinProduct")
    data class UnpinProduct(override val ref: String) : Command

    @Serializable @SerialName("purchase")
    data class Purchase(override val ref: String, val productId: String) : Command

    @Serializable @SerialName("shadowban")
    data class Shadowban(override val ref: String, val participantId: String) : Command

    @Serializable @SerialName("unshadowban")
    data class Unshadowban(override val ref: String, val participantId: String) : Command

    @Serializable @SerialName("ban")
    data class Ban(override val ref: String, val participantId: String) : Command
}

// ---------------------------------------------------------------- HTTP `/v1/`

@Serializable
internal data class LivesListResponse(val lives: List<LiveSummary>)

@Serializable
internal data class LivesCreateRequest(val title: String? = null)

@Serializable
internal data class LivesCreateResponse(val live: LiveSummary)

@Serializable
internal data class ImagesUploadResponse(val url: String)

@Serializable
internal data class HttpErrorBody(val error: Detail) {
    @Serializable
    data class Detail(val code: String, val message: String)
}
