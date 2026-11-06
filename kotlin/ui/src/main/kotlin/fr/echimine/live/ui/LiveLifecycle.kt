package fr.echimine.live.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.echimine.live.core.Audience
import fr.echimine.live.core.Live
import fr.echimine.live.core.LiveEndSummary
import fr.echimine.live.core.LiveResult
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.NumberFormat
import kotlin.time.Duration.Companion.seconds

/** L'Audience dans la barre du haut : « 👁 38 », un tap ouvre le détail par App d'origine. */
@Composable
internal fun AudienceChip(audience: Audience, onClick: () -> Unit) {
    val total = formatCount(audience.total)
    Text(
        "👁 $total",
        color = Color.White,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        modifier = Modifier
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.35f))
            .clickable(onClickLabel = "Voir l'Audience par App d'origine", onClick = onClick)
            .semantics { contentDescription = "Audience : $total Spectateurs" }
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

/** L'Audience détaillée par App d'origine, de la plus présente à la moins présente. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AudienceSheet(audience: Audience, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text("Audience", style = MaterialTheme.typography.titleMedium)
            Text(
                "${formatCount(audience.total)} ${if (audience.total > 1) "Spectateurs" else "Spectateur"}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            if (audience.ranked.isEmpty()) {
                Text("Aucun Spectateur pour l'instant.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            audience.ranked.forEach { (app, count) ->
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(app, Modifier.weight(1f))
                    Text(formatCount(count), fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

/**
 * Bandeaux de présence de l'Hôte, pour les autres Participants : « Hôte déconnecté » pendant son
 * Délai de grâce, puis « Hôte revenu » quelques secondes à son retour.
 */
@Composable
internal fun HostPresenceBanner(hostConnected: Boolean, modifier: Modifier = Modifier) {
    var wasDisconnected by remember { mutableStateOf(!hostConnected) }
    var showReturn by remember { mutableStateOf(false) }
    LaunchedEffect(hostConnected) {
        if (!hostConnected) {
            wasDisconnected = true
            showReturn = false
        } else if (wasDisconnected) {
            wasDisconnected = false
            showReturn = true
            delay(RETURN_BANNER)
            showReturn = false
        }
    }
    val text = when {
        !hostConnected -> "Hôte déconnecté · en attente de son retour…"
        showReturn -> "Hôte revenu"
        else -> null
    }
    var lastText by remember { mutableStateOf(text ?: "") }
    if (text != null) lastText = text
    AnimatedVisibility(
        visible = text != null,
        enter = fadeIn() + slideInVertically(),
        exit = fadeOut() + slideOutVertically(),
        modifier = modifier,
    ) {
        Text(
            lastText,
            color = Color.White,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .clip(RoundedCornerShape(LocalLiveTheme.current.cornerRadius))
                .background(if (hostConnected) Color(0xCC1E8E3E) else Color(0xCCB3261E))
                .padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}

private val RETURN_BANNER = 3.seconds

/** Hôte : confirme la fin du Live, pour tout le monde. */
@Composable
internal fun EndLiveDialog(live: Live, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var ending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!ending) onDismiss() },
        title = { Text("Terminer le Live ?") },
        text = {
            Text(error ?: "Tous les Participants en sortiront. Vous verrez ensuite le récapitulatif de votre Live.")
        },
        confirmButton = {
            Button(
                enabled = !ending,
                onClick = {
                    ending = true
                    error = null
                    scope.launch {
                        when (val result = live.endLive()) {
                            // La fin arrive par `liveEnded`, avec le récapitulatif.
                            is LiveResult.Success -> onDismiss()
                            is LiveResult.Failure -> {
                                error = "Le Live n'a pas pu être terminé : ${result.error.message}"
                                ending = false
                            }
                        }
                    }
                },
            ) { Text(if (ending) "Fin du Live…" else "Terminer") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !ending) { Text("Annuler") }
        },
    )
}

/** Hôte : récapitulatif de fin (Achats, Réactions, Audience), puis sortie du Live. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun EndSummarySheet(summary: LiveEndSummary, onClose: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onClose, sheetState = sheetState) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).navigationBarsPadding().padding(bottom = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Live terminé", style = MaterialTheme.typography.titleLarge)
            Text("Merci d'avoir animé ce Live !", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(20.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                SummaryStat("🛍", summary.purchases, "Achats")
                SummaryStat("❤️", summary.reactions, "Réactions")
                SummaryStat("👁", summary.peakAudience, "Audience max.")
            }
            Spacer(Modifier.height(24.dp))
            Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("Fermer") }
        }
    }
}

@Composable
private fun SummaryStat(symbol: String, value: Int, label: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.semantics(mergeDescendants = true) {}.width(96.dp),
    ) {
        Text(symbol, fontSize = 24.sp)
        Text(formatCount(value), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    }
}

/** Nombre formaté selon la locale du téléphone (« 1 284 »). */
private fun formatCount(value: Int): String = NumberFormat.getIntegerInstance().format(value)
