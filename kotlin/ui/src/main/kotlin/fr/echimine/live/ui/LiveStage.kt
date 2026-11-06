package fr.echimine.live.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import fr.echimine.live.core.Live
import fr.echimine.live.core.LiveDetails
import fr.echimine.live.core.LiveResult
import fr.echimine.live.core.MAX_COHOSTS
import fr.echimine.live.core.Participant
import fr.echimine.live.core.Role
import io.livekit.android.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// ---------------------------------------------------------------- mosaïque

/** Disposition portrait de la mosaïque : [columns] × [rows] tuiles. */
internal data class MosaicGrid(val columns: Int, val rows: Int)

/** 1 personne = plein écran, 2 = moitiés empilées, 3 ou 4 = 2 × 2, 5 ou 6 = 2 colonnes × 3 lignes. */
internal fun mosaicGrid(count: Int): MosaicGrid = when {
    count <= 1 -> MosaicGrid(1, 1)
    count == 2 -> MosaicGrid(1, 2)
    count <= 4 -> MosaicGrid(2, 2)
    else -> MosaicGrid(2, 3)
}

/**
 * Les personnes à l'écran ([stage] : l'Hôte en haut à gauche, puis les Co-hôtes par ordre de montée).
 * Chaque tuile ne reçoit que la qualité adaptée à sa taille (adaptive stream de la room).
 */
@Composable
internal fun StageMosaic(room: Room, stage: List<Participant>, you: Participant, modifier: Modifier = Modifier) {
    val grid = mosaicGrid(stage.size)
    val labelled = stage.size > 1
    Column(modifier) {
        repeat(grid.rows) { row ->
            Row(Modifier.weight(1f).fillMaxWidth()) {
                repeat(grid.columns) { column ->
                    val participant = stage.getOrNull(row * grid.columns + column)
                    val cell = Modifier.weight(1f).fillMaxSize()
                    if (participant == null) {
                        Box(cell.background(Color.Black))
                    } else {
                        key(participant.id) {
                            StageTile(room, participant, isYou = participant.id == you.id, labelled = labelled, modifier = cell)
                        }
                    }
                }
            }
        }
    }
}

/** Une tuile : la caméra du Participant (la sienne en miroir), son avatar tant qu'elle manque, son nom en mosaïque. */
@Composable
private fun StageTile(room: Room, participant: Participant, isYou: Boolean, labelled: Boolean, modifier: Modifier) {
    val camera by rememberCameraTrack(room, participant.id, isYou)
    Box(modifier.background(Color.Black)) {
        VideoTrackView(room, camera, mirror = isYou, modifier = Modifier.fillMaxSize())
        if (camera == null && labelled) {
            Avatar(participant, Modifier.align(Alignment.Center), size = 56.dp)
        }
        if (labelled) {
            Text(
                if (isYou) "Vous" else participantLine(participant),
                color = Color.White,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(6.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.45f))
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
    }
}

// ---------------------------------------------------------------- dock

/** Bouton du dock avec un compteur en pastille (masqué à 0). */
@Composable
internal fun BadgedDockButton(symbol: String, description: String, count: Int, onClick: () -> Unit) {
    Box {
        DockButton(symbol, description, Modifier.clickable(onClick = onClick))
        if (count > 0) {
            Text(
                if (count > 9) "9+" else count.toString(),
                color = MaterialTheme.colorScheme.onPrimary,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = 4.dp, y = (-4).dp)
                    .widthIn(min = 18.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary)
                    .padding(horizontal = 5.dp, vertical = 1.dp),
            )
        }
    }
}

/** Où en est un Spectateur ou un Co-hôte vis-à-vis de l'écran. */
internal enum class StagePosition { Viewer, Requested, Cohost }

internal val LiveDetails.stagePosition: StagePosition
    get() = when {
        role == Role.Cohost -> StagePosition.Cohost
        requestedToJoin -> StagePosition.Requested
        else -> StagePosition.Viewer
    }

/** ✋ du dock, pour un Spectateur ou un Co-hôte ; mis en avant tant que sa Demande de montée attend. */
@Composable
internal fun StageDockButton(details: LiveDetails, onClick: () -> Unit) {
    val position = details.stagePosition
    val description = when (position) {
        StagePosition.Cohost -> "Redescendre de l'écran"
        StagePosition.Requested -> "Demande de montée envoyée"
        StagePosition.Viewer -> "Demander à monter"
    }
    DockButton(
        "✋",
        description,
        Modifier
            .then(if (position != StagePosition.Viewer) Modifier.background(MaterialTheme.colorScheme.primary) else Modifier)
            .clickable(onClick = onClick),
    )
}

// ---------------------------------------------------------------- commandes des feuilles

/**
 * Lance les commandes d'une feuille : [pending] les clés (Participants) dont une commande est en cours,
 * [error] le dernier échec, effacé à la commande suivante.
 */
@Stable
internal class CommandRunner(private val scope: CoroutineScope) {
    var pending by mutableStateOf(emptySet<String>())
        private set
    var error by mutableStateOf<String?>(null)

    fun run(failure: String, key: String = "", onSuccess: () -> Unit = {}, action: suspend () -> LiveResult<Unit>) {
        pending = pending + key
        error = null
        scope.launch {
            when (val result = action()) {
                is LiveResult.Success -> onSuccess()
                is LiveResult.Failure -> error = "$failure : ${result.error.message}"
            }
            pending = pending - key
        }
    }
}

@Composable
private fun rememberCommandRunner(): CommandRunner {
    val scope = rememberCoroutineScope()
    return remember(scope) { CommandRunner(scope) }
}

@Composable
private fun ErrorLine(error: String?) {
    if (error == null) return
    Spacer(Modifier.height(12.dp))
    Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
}

// ---------------------------------------------------------------- ✋ Demande de montée

/**
 * ✋ : le Spectateur demande à monter (caméra et micro autorisés d'abord) ou annule sa demande ;
 * le Co-hôte redescend de lui-même.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun StageSheet(live: Live, details: LiveDetails, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val commands = rememberCommandRunner()
    val busy = commands.pending.isNotEmpty()

    val request = { commands.run("La demande n'a pas pu être envoyée", action = live::requestToJoin) }
    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (context.canPublish()) {
            request()
        } else {
            commands.error = "Autorisez la caméra et le micro pour monter à l'écran.\n" +
                "${LivePermissionTexts.CAMERA}\n${LivePermissionTexts.MICROPHONE}"
        }
    }

    val position = details.stagePosition
    val (title, body, label) = when (position) {
        StagePosition.Cohost -> Triple(
            "Vous êtes à l'écran",
            "Votre caméra et votre micro sont diffusés à tout le Live.",
            "Redescendre",
        )
        StagePosition.Requested -> Triple(
            "Demande envoyée",
            "En attente de la réponse de l'Hôte. Si elle est acceptée, votre caméra et votre micro s'allument.",
            "Annuler la demande",
        )
        StagePosition.Viewer -> Triple(
            "Monter à l'écran",
            "L'Hôte reçoit votre demande et peut l'accepter : votre caméra et votre micro s'allument alors.",
            "Demander à monter",
        )
    }
    val onClick = {
        when (position) {
            StagePosition.Cohost -> commands.run("Impossible de redescendre", onSuccess = onDismiss, action = live::leaveStage)
            StagePosition.Requested -> commands.run("La demande n'a pas pu être annulée", action = live::cancelJoinRequest)
            StagePosition.Viewer -> if (context.canPublish()) request() else permissions.launch(PUBLISH_PERMISSIONS)
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(body, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(16.dp))
            val content: @Composable RowScope.() -> Unit = { Text(if (busy) "…" else label) }
            // Annuler sa demande est un retour en arrière : bouton secondaire.
            if (position == StagePosition.Requested) {
                OutlinedButton(onClick, Modifier.fillMaxWidth(), enabled = !busy, content = content)
            } else {
                Button(onClick, Modifier.fillMaxWidth(), enabled = !busy, content = content)
            }
            ErrorLine(commands.error)
        }
    }
}

private val PUBLISH_PERMISSIONS = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)

private fun Context.canPublish(): Boolean = PUBLISH_PERMISSIONS
    .all { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }

// ---------------------------------------------------------------- ⚙️ Gestion

/**
 * ⚙️ Gestion, pour les Animateurs : Demandes de montée à accepter ou refuser et Co-hôtes à retirer
 * (actions de l'Hôte seul), avec la limite de [MAX_COHOSTS] Co-hôtes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ManagementSheet(live: Live, details: LiveDetails, onDismiss: () -> Unit) {
    val commands = rememberCommandRunner()
    val hosting = details.role == Role.Host
    val full = details.cohosts.size >= MAX_COHOSTS

    fun send(participantId: String, failure: String, action: suspend (String) -> LiveResult<Unit>) =
        commands.run(failure, key = participantId) { action(participantId) }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp),
        ) {
            Text("Gestion", style = MaterialTheme.typography.titleMedium)
            if (hosting) {
                Spacer(Modifier.height(16.dp))
                SectionTitle("Demandes de montée")
                if (details.joinRequests.isEmpty()) {
                    Hint("Aucune demande en attente.")
                }
                details.joinRequests.forEach { participant ->
                    val pending = participant.id in commands.pending
                    ParticipantRow(participant) {
                        TextButton(
                            enabled = !pending,
                            onClick = { send(participant.id, "Refus impossible", live::declineJoin) },
                        ) { Text("Refuser") }
                        Button(
                            enabled = !pending && !full,
                            onClick = { send(participant.id, "Acceptation impossible", live::acceptJoin) },
                        ) { Text("Accepter") }
                    }
                }
                if (full && details.joinRequests.isNotEmpty()) {
                    Hint("$MAX_COHOSTS Co-hôtes au plus : retirez-en un pour accepter une demande.")
                }
            }
            Spacer(Modifier.height(16.dp))
            SectionTitle("Co-hôtes · ${details.cohosts.size}/$MAX_COHOSTS")
            if (details.cohosts.isEmpty()) {
                Hint("Aucun Co-hôte à l'écran.")
            }
            details.cohosts.forEach { cohost ->
                ParticipantRow(cohost, you = cohost.id == details.you.id) {
                    if (hosting) {
                        TextButton(
                            enabled = cohost.id !in commands.pending,
                            onClick = { send(cohost.id, "Retrait impossible", live::removeCohost) },
                        ) { Text("Retirer") }
                    }
                }
            }
            ErrorLine(commands.error)
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 4.dp))
}

@Composable
private fun Hint(text: String) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, modifier = Modifier.padding(vertical = 4.dp))
}

/** Avatar, « pseudo · App d'origine », puis les actions. */
@Composable
private fun ParticipantRow(participant: Participant, you: Boolean = false, actions: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Avatar(participant, size = 36.dp)
        Spacer(Modifier.width(8.dp))
        Text(
            if (you) "${participantLine(participant)} (vous)" else participantLine(participant),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        actions()
    }
}
