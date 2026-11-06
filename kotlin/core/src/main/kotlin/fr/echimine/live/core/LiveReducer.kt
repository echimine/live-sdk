package fr.echimine.live.core

import fr.echimine.live.core.protocol.ServerMessage

/*
 * Réducteur du Live : comment un `snapshot` devient un [LiveDetails], et comment chaque événement
 * incrémental du serveur commun le met à jour. Pur, sans effet : testé à travers l'API de [Live].
 */

/** Les derniers messages du chat gardés en mémoire. */
internal const val MAX_MESSAGES: Int = 200

/** Le contenu d'un Live tel que le `snapshot` le décrit. */
internal fun ServerMessage.Snapshot.toDetails(): LiveDetails = LiveDetails(
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

/** Applique un événement incrémental ; un message sans effet sur le contenu rend `this`. */
internal fun LiveDetails.applying(message: ServerMessage): LiveDetails = when (message) {
    ServerMessage.HostDisconnected -> copy(hostConnected = false)
    ServerMessage.HostReconnected -> copy(hostConnected = true)
    is ServerMessage.JoinRequested ->
        if (joinRequests.any { it.id == message.participant.id }) this
        else copy(joinRequests = joinRequests + message.participant)
    is ServerMessage.JoinRequestCancelled -> copy(joinRequests = joinRequests.filterNot { it.id == message.participantId })
    ServerMessage.JoinDeclined -> copy(requestedToJoin = false)
    is ServerMessage.RoleChanged -> applyingRoleChange(message)
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

/**
 * Montée ou descente d'un Participant : la liste des Co-hôtes garde l'ordre de montée ; si c'est soi,
 * son rôle change (les listes de modération ne sont visibles que des Animateurs) et sa Demande de
 * montée n'existe plus.
 */
private fun LiveDetails.applyingRoleChange(message: ServerMessage.RoleChanged): LiveDetails {
    val participant = message.participant
    val others = cohosts.filterNot { it.id == participant.id }
    val isYou = participant.id == you.id
    val newRole = if (isYou) message.role else role
    return copy(
        role = newRole,
        cohosts = if (message.role == Role.Cohost) others + participant else others,
        joinRequests = joinRequests.filterNot { it.id == participant.id },
        moderation = moderation.takeIf { newRole.isAnimator },
        requestedToJoin = requestedToJoin && !isYou,
    )
}
