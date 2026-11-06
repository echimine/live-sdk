package fr.echimine.live.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.echimine.live.core.ChatMessage
import fr.echimine.live.core.Live
import fr.echimine.live.core.LiveConfig
import fr.echimine.live.core.LiveErrorCode
import fr.echimine.live.core.LiveResult
import fr.echimine.live.core.Role
import fr.echimine.live.core.visibleLength
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeMark

/** Les 2 derniers messages, au-dessus du dock ; un tap ouvre le chat. */
@Composable
internal fun ChatPreview(messages: List<ChatMessage>, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val last = messages.takeLast(2)
    if (last.isEmpty()) return
    Column(
        modifier
            .clip(RoundedCornerShape(LocalLiveTheme.current.cornerRadius))
            .clickable(onClickLabel = "Ouvrir le chat", onClick = onOpen)
            .padding(4.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        last.forEach { message ->
            Text(
                previewLine(message),
                color = Color.White,
                fontSize = 14.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .clip(RoundedCornerShape(LocalLiveTheme.current.cornerRadius))
                    .background(Color.Black.copy(alpha = 0.35f))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }
    }
}

private fun previewLine(message: ChatMessage) = buildAnnotatedString {
    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(message.author.name) }
    append("  ")
    append(chatBody(message))
}

/**
 * Le chat en feuille mi-hauteur : messages (pseudo, App d'origine, rôle) et champ de saisie.
 * [onMessageTap] (Animateurs seuls) : un message touché ouvre ses actions de modération.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatSheet(
    live: Live,
    config: LiveConfig,
    messages: List<ChatMessage>,
    locked: Boolean,
    unlockAt: TimeMark?,
    onDismiss: () -> Unit,
    onMessageTap: ((ChatMessage) -> Unit)? = null,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.5f).imePadding()) {
            Text(
                "Chat",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            val listState = rememberLazyListState()
            LaunchedEffect(messages.lastOrNull()?.id) {
                // Suit les nouveaux messages, sauf si l'historique est en cours de lecture plus haut.
                val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
                if (messages.isNotEmpty() && lastVisible >= messages.lastIndex - 2) {
                    listState.animateScrollToItem(messages.lastIndex)
                }
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (messages.isEmpty()) {
                    item {
                        Text(
                            "Aucun message pour l'instant.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(messages, key = { it.id }) { message ->
                    val modifier = if (onMessageTap == null) Modifier
                    else Modifier.clickable(onClickLabel = "Modérer ce message") { onMessageTap(message) }
                    ChatMessageRow(message, modifier)
                }
            }
            ChatInput(live, config.chatMaxLength, locked, unlockAt)
        }
    }
}

@Composable
private fun ChatMessageRow(message: ChatMessage, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Avatar(message.author, size = 32.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    message.author.name,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Text(
                    " · ${message.author.app}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                    maxLines = 1,
                )
                roleLabel(message.role)?.let { RoleBadge(it) }
            }
            Text(chatBody(message), color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun RoleBadge(label: String) {
    Spacer(Modifier.width(6.dp))
    Text(
        label,
        color = MaterialTheme.colorScheme.onPrimary,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .clip(RoundedCornerShape(LocalLiveTheme.current.cornerRadius))
            .background(MaterialTheme.colorScheme.primary)
            .padding(horizontal = 6.dp, vertical = 1.dp),
    )
}

/**
 * Champ de saisie : vide ou trop long, l'envoi est impossible et la saisie reste ;
 * après un `rate_limited`, le champ est verrouillé avec « Doucement… » le temps indiqué.
 */
@Composable
private fun ChatInput(live: Live, max: Int, locked: Boolean, unlockAt: TimeMark?) {
    val scope = rememberCoroutineScope()
    // Décompte par seconde jusqu'à la fin du verrou : « Doucement… 4 s ».
    var remainingSeconds by remember(unlockAt) { mutableStateOf<Int?>(null) }
    LaunchedEffect(unlockAt) {
        if (unlockAt == null) return@LaunchedEffect
        while (true) {
            val remaining = (-unlockAt.elapsedNow()).coerceAtLeast(Duration.ZERO)
            val seconds = ((remaining.inWholeMilliseconds + 999) / 1000).toInt()
            remainingSeconds = seconds
            if (seconds == 0) break
            delay(remaining - (seconds - 1).seconds)
        }
    }
    val lockHint = "Doucement…" + (remainingSeconds?.takeIf { it > 0 }?.let { " $it s" } ?: "")
    var draft by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val length = visibleLength(draft.trim())
    val tooLong = length > max
    val canSend = length in 1..max && !locked && !sending

    fun send() {
        if (!canSend) return
        val text = draft
        sending = true
        error = null
        scope.launch {
            when (val result = live.sendMessage(text)) {
                is LiveResult.Success -> if (draft == text) draft = ""
                is LiveResult.Failure ->
                    // `rate_limited` verrouille le champ via l'état du Live ; le reste s'affiche ici.
                    if (result.error.code != LiveErrorCode.RateLimited) error = result.error.displayMessage()
            }
            sending = false
        }
    }

    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = draft,
                onValueChange = {
                    draft = it
                    error = null
                },
                enabled = !locked,
                placeholder = { Text(if (locked) lockHint else "Ajouter un message…") },
                isError = tooLong || error != null,
                maxLines = 4,
                shape = RoundedCornerShape(LocalLiveTheme.current.cornerRadius),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            TextButton(onClick = ::send, enabled = canSend) { Text("Envoyer") }
        }
        val hint = when {
            locked -> lockHint
            error != null -> error
            tooLong -> "Trop long : $length / $max caractères"
            length > max - COUNTER_THRESHOLD -> "$length / $max"
            else -> null
        }
        if (hint != null) {
            Text(
                hint,
                fontSize = 12.sp,
                color = if (tooLong || error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, top = 4.dp),
            )
        }
    }
}

/** Le compteur n'apparaît qu'à l'approche de la limite. */
private const val COUNTER_THRESHOLD = 30

private fun roleLabel(role: Role): String? = when (role) {
    Role.Host -> "Hôte"
    Role.Cohost -> "Co-hôte"
    Role.Viewer, Role.Unknown -> null
}

internal fun chatBody(message: ChatMessage): String = when (message) {
    is ChatMessage.Text -> message.text
    is ChatMessage.Purchase ->
        "🛍 a acheté ${message.product.name} · ${formatPrice(message.product.price, message.product.currency)}"
}

