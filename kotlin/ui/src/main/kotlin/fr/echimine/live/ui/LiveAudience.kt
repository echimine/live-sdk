package fr.echimine.live.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import java.text.NumberFormat

/** L'Audience dans la barre du haut : « 👁 38 », un tap ouvre le détail par App d'origine. */
@Composable
internal fun AudienceChip(audience: Audience, onClick: () -> Unit) {
    Text(
        "👁 ${formatCount(audience.total)}",
        color = Color.White,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        modifier = Modifier
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.35f))
            .clickable(onClickLabel = "Voir l'Audience par App d'origine", onClick = onClick)
            .semantics { contentDescription = "Audience : ${spectators(audience.total)}" }
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
                spectators(audience.total),
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

/** Nombre formaté selon la locale du téléphone (« 1 284 »). */
internal fun formatCount(value: Int): String = NumberFormat.getIntegerInstance().format(value)

/** « 1 Spectateur », « 38 Spectateurs ». */
internal fun spectators(count: Int): String = "${formatCount(count)} ${if (count > 1) "Spectateurs" else "Spectateur"}"
