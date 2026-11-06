package fr.echimine.live.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.echimine.live.core.ChatMessage
import fr.echimine.live.core.LiveEvent
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.mapNotNull

/** Un toast en haut de l'écran : un symbole et une ligne de texte. */
internal data class LiveToast(val symbol: String, val text: String)

/** Les événements qui s'annoncent en toast : Annonces d'achat et refus d'une Demande de montée. */
internal fun toastOf(event: LiveEvent): LiveToast? = when (event) {
    is LiveEvent.PurchaseAnnounced -> LiveToast("🛍", purchaseLine(event.message))
    LiveEvent.JoinDeclined -> LiveToast("✋", "L'Hôte n'a pas retenu votre demande de montée.")
    is LiveEvent.ReactionsReceived -> null
}

/** Les toasts de [events]. */
internal fun Flow<LiveEvent>.toasts(): Flow<LiveToast> = mapNotNull(::toastOf)

/**
 * Affiche les [toasts] l'un après l'autre, quelques secondes chacun ;
 * en rafale, seuls les plus récents attendent leur tour.
 */
@Composable
internal fun LiveToasts(toasts: Flow<LiveToast>, modifier: Modifier = Modifier) {
    var shown by remember { mutableStateOf<LiveToast?>(null) }
    LaunchedEffect(toasts) {
        toasts.buffer(TOAST_QUEUE, BufferOverflow.DROP_OLDEST).collect { toast ->
            shown = toast
            delay(TOAST_DURATION_MS)
            shown = null
            delay(TOAST_GAP_MS) // laisse le toast sortir avant le suivant
        }
    }
    AnimatedVisibility(
        visible = shown != null,
        enter = fadeIn() + slideInVertically { -it },
        exit = fadeOut() + slideOutVertically { -it },
        modifier = modifier,
    ) {
        val toast = shown ?: return@AnimatedVisibility
        Row(
            Modifier
                .clip(RoundedCornerShape(LocalLiveTheme.current.cornerRadius))
                .background(MaterialTheme.colorScheme.primary)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(toast.symbol, fontSize = 18.sp)
            Spacer(Modifier.width(8.dp))
            Text(
                toast.text,
                color = MaterialTheme.colorScheme.onPrimary,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** « Noa a acheté Baskets Runner X · 89,99 € ». */
internal fun purchaseLine(message: ChatMessage.Purchase): String =
    "${message.author.name} a acheté ${message.product.name} · ${formatPrice(message.product.price, message.product.currency)}"

private const val TOAST_DURATION_MS = 3_000L
private const val TOAST_GAP_MS = 300L
private const val TOAST_QUEUE = 3
