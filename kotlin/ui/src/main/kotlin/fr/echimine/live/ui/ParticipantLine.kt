package fr.echimine.live.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.echimine.live.core.Participant

/** « pseudo · App d'origine », en texte seul (étiquette d'une tuile de la mosaïque). */
internal fun participantLine(participant: Participant): String = "${participant.name} · ${participant.app}"

/**
 * Un Participant tel que tous les écrans le présentent : son avatar, puis « pseudo · App d'origine ».
 * Avec [headline] (titre du Live), celui-ci passe en gras au-dessus et la ligne du Participant en petit.
 * [badge] suit le pseudo (rôle dans le chat) ; [content] vient sous la ligne (corps d'un message).
 * [onVideo] : blanc sur fond vidéo, sinon les couleurs de la surface.
 */
@Composable
internal fun ParticipantLine(
    participant: Participant,
    modifier: Modifier = Modifier,
    avatarSize: Dp = 32.dp,
    headline: String? = null,
    onVideo: Boolean = false,
    badge: (@Composable () -> Unit)? = null,
    content: (@Composable () -> Unit)? = null,
) {
    val primary = if (onVideo) Color.White else MaterialTheme.colorScheme.onSurface
    val secondary = if (onVideo) Color.White.copy(alpha = 0.75f) else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier.semantics(mergeDescendants = true) {},
        verticalAlignment = if (content == null) Alignment.CenterVertically else Alignment.Top,
    ) {
        Avatar(participant, size = avatarSize)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            if (headline != null) {
                Text(headline, color = primary, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    participant.name,
                    color = if (headline == null) primary else secondary,
                    fontWeight = if (headline == null) FontWeight.SemiBold else FontWeight.Normal,
                    fontSize = if (headline == null) 16.sp else 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Text(
                    " · ${participant.app}",
                    color = secondary,
                    fontSize = if (headline == null) 13.sp else 12.sp,
                    maxLines = 1,
                )
                badge?.invoke()
            }
            content?.invoke()
        }
    }
}
