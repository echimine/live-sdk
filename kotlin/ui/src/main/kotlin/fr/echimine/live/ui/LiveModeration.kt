package fr.echimine.live.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.echimine.live.core.ChatMessage
import fr.echimine.live.core.Live
import fr.echimine.live.core.LiveDetails
import fr.echimine.live.core.LiveError
import fr.echimine.live.core.LiveErrorCode
import fr.echimine.live.core.LiveResult
import fr.echimine.live.core.MAX_COHOSTS
import fr.echimine.live.core.Participant
import fr.echimine.live.core.Role
import kotlinx.coroutines.launch

/** Ce qu'un Animateur peut faire d'un message touché. */
internal enum class MessageAction { Delete, Shadowban, Ban }

/**
 * Actions offertes sur [message] selon son rôle, comme le serveur commun les accepterait :
 * rien pour un Spectateur ; l'Hôte et soi-même ne sont jamais modérés ; un Co-hôte n'est
 * modérable que par l'Hôte ; pas de second Shadowban.
 */
internal fun messageActions(details: LiveDetails, message: ChatMessage): List<MessageAction> {
    if (!details.role.isAnimator) return emptyList()
    val author = message.author.id
    val moderation = details.moderation
    val banned = moderation?.banned.orEmpty().any { it.id == author }
    val shadowbanned = moderation?.shadowbanned.orEmpty().any { it.id == author }
    val moderable = author != details.you.id &&
        author != details.host.id &&
        !banned &&
        (details.role == Role.Host || details.cohosts.none { it.id == author })
    return buildList {
        add(MessageAction.Delete)
        if (moderable && !shadowbanned) add(MessageAction.Shadowban)
        if (moderable) add(MessageAction.Ban)
    }
}

/** Animateur : un message touché → supprimer, Shadowban ou Bannissement (après confirmation). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MessageActionsSheet(live: Live, details: LiveDetails, message: ChatMessage, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmBan by remember { mutableStateOf(false) }
    val author = message.author
    val actions = messageActions(details, message)

    fun perform(command: suspend () -> LiveResult<Unit>) {
        busy = true
        error = null
        scope.launch {
            when (val result = command()) {
                is LiveResult.Success -> onDismiss()
                is LiveResult.Failure -> {
                    error = result.error.displayMessage()
                    busy = false
                }
            }
        }
    }

    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).navigationBarsPadding().padding(bottom = 16.dp)) {
            ParticipantLine(author)
            Spacer(Modifier.height(8.dp))
            Text(
                chatBody(message),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
            Spacer(Modifier.height(16.dp))
            actions.forEach { action ->
                when (action) {
                    MessageAction.Delete -> ActionButton("Supprimer le message", enabled = !busy) {
                        perform { live.deleteMessage(message.id) }
                    }
                    MessageAction.Shadowban -> ActionButton("Shadowban de ${author.name}", enabled = !busy) {
                        perform { live.shadowban(author.id) }
                    }
                    MessageAction.Ban -> ActionButton("Bannir ${author.name} du Live", enabled = !busy, destructive = true) {
                        confirmBan = true
                    }
                }
            }
        }
    }

    if (confirmBan) {
        AlertDialog(
            onDismissRequest = { confirmBan = false },
            title = { Text("Bannir ${author.name} ?") },
            text = { Text("${author.name} sera exclu de ce Live tout de suite, et définitivement. Ses messages restent.") },
            confirmButton = {
                Button(
                    onClick = {
                        confirmBan = false
                        perform { live.ban(author.id) }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text("Bannir") }
            },
            dismissButton = { TextButton(onClick = { confirmBan = false }) { Text("Annuler") } },
        )
    }
}

/**
 * ⚙️ Gestion des Animateurs : Demandes de montée et Co-hôtes (Hôte), Produit épinglé,
 * Shadowbans à lever, fin du Live (Hôte).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ManagementSheet(
    live: Live,
    details: LiveDetails,
    onPinProduct: () -> Unit,
    onEndLive: () -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(emptySet<String>()) }
    var error by remember { mutableStateOf<String?>(null) }
    val hosting = details.role == Role.Host
    val stageFull = details.cohosts.size >= MAX_COHOSTS

    fun perform(participantId: String, command: suspend () -> LiveResult<Unit>) {
        busy = busy + participantId
        error = null
        scope.launch {
            val result = command()
            if (result is LiveResult.Failure) error = result.error.displayMessage()
            busy = busy - participantId
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp).navigationBarsPadding().padding(bottom = 16.dp),
        ) {
            Text("Gestion", style = MaterialTheme.typography.titleMedium)
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }

            if (hosting) {
                SectionTitle("Demandes de montée")
                if (details.joinRequests.isEmpty()) EmptyLine("Aucune Demande de montée.")
                details.joinRequests.forEach { participant ->
                    ParticipantRow(participant) {
                        val enabled = participant.id !in busy
                        TextButton(onClick = { perform(participant.id) { live.declineJoin(participant.id) } }, enabled = enabled) {
                            Text("Refuser")
                        }
                        Button(
                            onClick = { perform(participant.id) { live.acceptJoin(participant.id) } },
                            enabled = enabled && !stageFull,
                        ) { Text("Accepter") }
                    }
                }
                if (stageFull && details.joinRequests.isNotEmpty()) {
                    EmptyLine(LiveError(LiveErrorCode.CohostLimit, "").displayMessage())
                }
            }

            SectionTitle("Co-hôtes (${details.cohosts.size}/$MAX_COHOSTS)")
            if (details.cohosts.isEmpty()) EmptyLine("Personne n'est monté à l'écran.")
            details.cohosts.forEach { participant ->
                ParticipantRow(participant) {
                    if (hosting) {
                        OutlinedButton(
                            onClick = { perform(participant.id) { live.removeCohost(participant.id) } },
                            enabled = participant.id !in busy,
                        ) { Text("Retirer") }
                    }
                }
            }

            SectionTitle("Produit épinglé")
            Row(verticalAlignment = Alignment.CenterVertically) {
                val pinned = details.pinnedProduct
                Text(
                    pinned?.let { "${it.name} · ${formatPrice(it.price, it.currency)}" } ?: "Aucun produit épinglé.",
                    color = if (pinned == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                OutlinedButton(onClick = onPinProduct) { Text(if (pinned == null) "Épingler" else "Changer") }
            }

            SectionTitle("Shadowbans")
            // Un Co-hôte en Shadowban ne doit pas l'apprendre ici.
            val shadowbanned = details.moderation?.shadowbanned.orEmpty().filterNot { it.id == details.you.id }
            if (shadowbanned.isEmpty()) EmptyLine("Aucun Participant en Shadowban.")
            shadowbanned.forEach { participant ->
                ParticipantRow(participant) {
                    OutlinedButton(
                        onClick = { perform(participant.id) { live.unshadowban(participant.id) } },
                        enabled = participant.id !in busy,
                    ) { Text("Lever") }
                }
            }

            if (hosting) {
                Spacer(Modifier.height(20.dp))
                HorizontalDivider()
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = onEndLive,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Terminer le Live") }
            }
        }
    }
}

/** ⚙️ du dock, avec le nombre de Demandes de montée en attente. */
@Composable
internal fun ManagementDockButton(pendingRequests: Int, onClick: () -> Unit) {
    val description = when {
        pendingRequests > 1 -> "Gestion, ${formatCount(pendingRequests)} Demandes de montée"
        pendingRequests == 1 -> "Gestion, 1 Demande de montée"
        else -> "Gestion"
    }
    Box {
        DockButton("⚙️", description = description, modifier = Modifier.clickable(onClickLabel = "Ouvrir la Gestion", onClick = onClick))
        if (pendingRequests > 0) {
            Text(
                formatCount(pendingRequests),
                color = MaterialTheme.colorScheme.onPrimary,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = 4.dp, y = (-4).dp)
                    .defaultMinSize(minWidth = 18.dp)
                    .background(MaterialTheme.colorScheme.primary, CircleShape)
                    .padding(horizontal = 5.dp, vertical = 1.dp)
                    .clearAndSetSemantics {}, // déjà dit par la description du bouton
            )
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Spacer(Modifier.height(16.dp))
    Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
    Spacer(Modifier.height(4.dp))
}

@Composable
private fun EmptyLine(text: String) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, modifier = Modifier.padding(vertical = 4.dp))
}

/** Un Participant d'une liste de Gestion, avec ses boutons à droite. */
@Composable
private fun ParticipantRow(participant: Participant, actions: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        ParticipantLine(participant, Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        actions()
    }
}

@Composable
private fun ActionButton(label: String, enabled: Boolean, destructive: Boolean = false, onClick: () -> Unit) {
    TextButton(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
        Text(
            label,
            color = if (destructive && enabled) MaterialTheme.colorScheme.error else Color.Unspecified,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
