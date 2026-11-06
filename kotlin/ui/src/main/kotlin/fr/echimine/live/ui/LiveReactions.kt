package fr.echimine.live.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/** Bouton ❤️ du dock : un tap envoie la Réaction rapide, un appui long ouvre le jeu complet. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun QuickReactionButton(emoji: String, onReact: () -> Unit, onOpenAll: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    DockButton(
        emoji,
        description = "Réagir $emoji ; appui long pour toutes les Réactions",
        modifier = Modifier.combinedClickable(
            onClickLabel = "Réagir",
            onLongClickLabel = "Toutes les Réactions",
            onLongClick = {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onOpenAll()
            },
            onClick = onReact,
        ),
    )
}

/** Bouton rond du dock, sur fond vidéo. */
@Composable
internal fun DockButton(symbol: String, description: String, modifier: Modifier = Modifier) {
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.35f))
            .then(modifier)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Text(symbol, fontSize = 22.sp)
    }
}

/** Le jeu complet de Réactions, en grille ; la feuille reste ouverte pour en enchaîner plusieurs. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReactionSheet(reactions: List<String>, onReact: (String) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text(
            "Réactions",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        LazyVerticalGrid(
            columns = GridCells.Fixed(4),
            contentPadding = PaddingValues(16.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            items(reactions) { emoji ->
                Box(
                    Modifier
                        .aspectRatio(1f)
                        .clip(RoundedCornerShape(LocalLiveTheme.current.cornerRadius))
                        .clickable(onClickLabel = "Réagir $emoji") { onReact(emoji) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(emoji, fontSize = 34.sp)
                }
            }
        }
    }
}

/** Réactions en vol : chaque fenêtre reçue lance quelques emojis, étalés sur ses 500 ms. */
@Stable
internal class FloatingReactions {
    internal class Item(val id: Long, val emoji: String, val x: Float, val delayMs: Long)

    val items = mutableStateListOf<Item>()
    private var nextId = 0L

    fun launch(counts: Map<String, Int>) {
        val batch = counts.flatMap { (emoji, count) -> List(minOf(count, MAX_PER_EMOJI)) { emoji } }
            .shuffled()
            .take(minOf(MAX_PER_WINDOW, MAX_ON_SCREEN - items.size))
        batch.forEachIndexed { index, emoji ->
            items += Item(nextId++, emoji, Random.nextFloat(), WINDOW_MS * index / batch.size)
        }
    }

    fun remove(item: Item) {
        items.remove(item)
    }

    private companion object {
        const val MAX_PER_EMOJI = 6
        const val MAX_PER_WINDOW = 12
        const val MAX_ON_SCREEN = 40
        const val WINDOW_MS = 500L
    }
}

/** Les Réactions de tous qui montent en flottant. */
@Composable
internal fun FloatingReactionsLayer(state: FloatingReactions, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier) {
        val density = LocalDensity.current
        val size = 36.dp
        val sizePx = with(density) { size.toPx() }
        val wobblePx = with(density) { 10.dp.toPx() }
        val width = constraints.maxWidth - sizePx
        val height = constraints.maxHeight - sizePx
        state.items.forEach { item ->
            key(item.id) {
                val progress = remember { Animatable(0f) }
                LaunchedEffect(Unit) {
                    delay(item.delayMs)
                    progress.animateTo(1f, tween(FLIGHT_MS, easing = LinearOutSlowInEasing))
                    state.remove(item)
                }
                Text(
                    item.emoji,
                    fontSize = 28.sp,
                    modifier = Modifier
                        .offset {
                            val p = progress.value
                            val x = item.x * width + sin(p * 3 * PI).toFloat() * wobblePx
                            IntOffset(x.roundToInt(), (height * (1 - p)).roundToInt())
                        }
                        .graphicsLayer {
                            val p = progress.value
                            alpha = when {
                                p == 0f -> 0f
                                p < FADE_FROM -> 1f
                                else -> (1 - p) / (1 - FADE_FROM)
                            }
                            val grow = 0.6f + 0.4f * minOf(1f, p * 6)
                            scaleX = grow
                            scaleY = grow
                        },
                )
            }
        }
    }
}

private const val FLIGHT_MS = 2400
private const val FADE_FROM = 0.7f
