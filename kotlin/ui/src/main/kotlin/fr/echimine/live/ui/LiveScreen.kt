package fr.echimine.live.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import fr.echimine.live.core.Live
import fr.echimine.live.core.LiveClient
import fr.echimine.live.core.LiveEvent
import fr.echimine.live.core.LiveSdk
import fr.echimine.live.core.LiveState
import fr.echimine.live.core.LiveState.Connection
import fr.echimine.live.core.Participant
import fr.echimine.live.core.Role

/**
 * Ouvre le Live [liveId] et l'affiche en plein écran ; le quitte quand l'écran disparaît.
 * Pour brancher ses propres liens et boutons.
 */
@Composable
public fun LiveScreen(
    liveId: String,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    client: LiveClient = LiveSdk.client,
) {
    val live by produceState<Live?>(null, client, liveId) {
        val opened = client.openLive(liveId)
        value = opened
        awaitDispose { opened.close() }
    }
    val opened = live
    if (opened == null) {
        LiveSdkTheme { Box(modifier.fillMaxSize().background(Color.Black), Alignment.Center) { Loading() } }
    } else {
        LiveScreen(opened, onClose, modifier)
    }
}

/**
 * Un Live ouvert en plein écran : vidéo de l'Hôte, barre du haut (libellé du Live, ✕) et dock.
 * Quitte [live] quand l'écran disparaît.
 */
@Composable
public fun LiveScreen(
    live: Live,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    DisposableEffect(live) { onDispose { live.close() } }
    val state by live.state.collectAsStateWithLifecycle()
    val config by live.config.collectAsStateWithLifecycle()
    val room = rememberLiveRoom(live)
    val details = state.live
    val host = details?.host
    val hostIsYou = host != null && host.id == details.you.id
    val camera by rememberCameraTrack(room, host?.id, hostIsYou)
    val interactive = details != null && !state.connection.isFinal
    var chatOpen by rememberSaveable(live.id) { mutableStateOf(false) }
    var reactionsOpen by rememberSaveable(live.id) { mutableStateOf(false) }
    var audienceOpen by rememberSaveable(live.id) { mutableStateOf(false) }
    var endOpen by rememberSaveable(live.id) { mutableStateOf(false) }
    // L'Hôte termine son Live en le quittant ; les autres le quittent simplement.
    val onQuit = { if (hostIsYou && interactive) endOpen = true else onClose() }
    val floating = remember(live) { FloatingReactions() }
    LaunchedEffect(live) {
        live.events.collect { event -> if (event is LiveEvent.ReactionsReceived) floating.launch(event.counts) }
    }

    LiveSdkTheme {
        Box(modifier.fillMaxSize().background(Color.Black)) {
            VideoTrackView(room, camera, mirror = hostIsYou, modifier = Modifier.fillMaxSize())
            Scrims()
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                TopBar(state, onQuit, onOpenAudience = { audienceOpen = true })
                Box(Modifier.weight(1f).fillMaxWidth(), Alignment.Center) {
                    if (interactive && !hostIsYou) {
                        HostPresenceBanner(details.hostConnected, Modifier.align(Alignment.TopCenter).padding(top = 8.dp))
                    }
                    StatusOverlay(state, hasVideo = camera != null, onClose = onClose)
                    FloatingReactionsLayer(
                        floating,
                        Modifier.align(Alignment.BottomEnd).width(120.dp).fillMaxHeight(0.7f),
                    )
                }
                if (interactive) {
                    ChatPreview(
                        details.messages,
                        onOpen = { chatOpen = true },
                        modifier = Modifier.padding(horizontal = 8.dp).fillMaxWidth(0.75f),
                    )
                }
                Dock {
                    if (interactive) {
                        ChatPill(onClick = { chatOpen = true })
                        val quick = config.quickReaction
                        QuickReactionButton(quick, onReact = { live.react(quick) }, onOpenAll = { reactionsOpen = true })
                        DockButton(
                            "😀",
                            description = "Toutes les Réactions",
                            modifier = Modifier.clickable { reactionsOpen = true },
                        )
                    }
                }
            }
            if (chatOpen && interactive) {
                ChatSheet(live, config, details.messages, state.chatLocked, onDismiss = { chatOpen = false })
            }
            if (reactionsOpen && interactive) {
                ReactionSheet(config.reactions, onReact = live::react, onDismiss = { reactionsOpen = false })
            }
            if (audienceOpen && interactive) {
                AudienceSheet(details.audience, onDismiss = { audienceOpen = false })
            }
            if (endOpen && interactive) {
                EndLiveDialog(live, onDismiss = { endOpen = false })
            }
            val summary = (state.connection as? Connection.Ended)?.summary
            if (summary != null) {
                EndSummarySheet(summary, onClose = onClose)
            }
        }
    }
}

/** Le 💬 du dock : ouvre le chat. */
@Composable
private fun RowScope.ChatPill(onClick: () -> Unit) {
    Text(
        "💬  Ajouter un message…",
        color = Color.White.copy(alpha = 0.85f),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .weight(1f)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.35f))
            .clickable(onClickLabel = "Ouvrir le chat", onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

@Composable
private fun Scrims() {
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxWidth().height(140.dp)
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.55f), Color.Transparent))),
        )
        Box(
            Modifier.fillMaxWidth().height(160.dp).align(Alignment.BottomCenter)
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.55f)))),
        )
    }
}

@Composable
private fun TopBar(state: LiveState, onClose: () -> Unit, onOpenAudience: () -> Unit) {
    val theme = LocalLiveTheme.current
    val details = state.live
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            theme.label,
            color = MaterialTheme.colorScheme.onPrimary,
            fontWeight = FontWeight.Bold,
            fontSize = 13.sp,
            modifier = Modifier
                .clip(RoundedCornerShape(theme.cornerRadius))
                .background(MaterialTheme.colorScheme.primary)
                .padding(horizontal = 10.dp, vertical = 4.dp),
        )
        if (details != null) {
            Spacer(Modifier.width(10.dp))
            Avatar(details.host, size = 30.dp)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    details.title ?: details.host.name,
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    hostLine(details.host),
                    color = Color.White.copy(alpha = 0.75f),
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(8.dp))
            AudienceChip(details.audience, onClick = onOpenAudience)
            Spacer(Modifier.width(8.dp))
        } else {
            Spacer(Modifier.weight(1f))
        }
        val hosting = details != null && details.role == Role.Host && !state.connection.isFinal
        CloseButton(if (hosting) "Terminer le Live" else "Quitter le Live", onClose)
    }
}

/** Le dock, en bas : 💬 chat, ❤️ Réaction rapide, 😀 toutes les Réactions (puis 🛍, 👥, ✋). */
@Composable
private fun Dock(content: @Composable RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Composable
private fun StatusOverlay(state: LiveState, hasVideo: Boolean, onClose: () -> Unit) {
    val message = when (val connection = state.connection) {
        Connection.Connecting -> "Connexion au Live…"
        is Connection.Reconnecting -> "Connexion perdue, reconnexion…"
        // L'Hôte absent est signalé par le bandeau « Hôte déconnecté ».
        Connection.Connected -> "En attente de la vidéo…".takeIf { !hasVideo && state.live?.hostConnected != false }
        // L'Hôte voit à la place son récapitulatif de fin.
        is Connection.Ended -> if (connection.summary != null) null else when (connection.reason) {
            LiveState.EndReason.HostTimeout -> "Le Live est terminé : l'Hôte n'est pas revenu."
            else -> "Le Live est terminé."
        }
        Connection.Replaced -> "Ce Live est ouvert sur un autre appareil."
        Connection.Banned -> "Vous avez été banni de ce Live."
        is Connection.Failed -> "Impossible d'ouvrir ce Live : ${connection.error.message}"
        Connection.Closed -> null
    } ?: return
    val final = state.connection.isFinal
    Column(
        Modifier
            .padding(24.dp)
            .clip(RoundedCornerShape(LocalLiveTheme.current.cornerRadius))
            .background(Color.Black.copy(alpha = 0.6f))
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (!final) {
            Loading()
            Spacer(Modifier.height(12.dp))
        }
        Text(message, color = Color.White, textAlign = TextAlign.Center)
        if (final) {
            Spacer(Modifier.height(16.dp))
            Button(onClick = onClose) { Text("Fermer") }
        }
    }
}

/** Bouton ✕ rond, sur fond vidéo. */
@Composable
internal fun CloseButton(description: String, onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.35f))
            .semantics { contentDescription = description },
    ) {
        Text("✕", color = Color.White, fontSize = 18.sp)
    }
}

/** « pseudo · App d'origine ». */
internal fun hostLine(host: Participant): String = "${host.name} · ${host.app}"

@Composable
internal fun Loading() {
    CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(28.dp))
}
