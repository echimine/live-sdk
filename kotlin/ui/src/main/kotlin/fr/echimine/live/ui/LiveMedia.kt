package fr.echimine.live.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import fr.echimine.live.core.Live
import fr.echimine.live.core.LiveState
import fr.echimine.live.core.Role
import io.livekit.android.LiveKit
import io.livekit.android.RoomOptions
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.RemoteVideoTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import io.livekit.android.room.track.video.ViewVisibility
import io.livekit.android.util.flow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlin.time.Duration.Companion.seconds
import livekit.org.webrtc.RendererCommon.ScalingType

internal fun newRoom(context: Context): Room = LiveKit.create(
    context.applicationContext,
    // Simulcast + adaptive stream : chaque abonnement reçoit la couche adaptée à sa taille et au réseau.
    RoomOptions(adaptiveStream = true, dynacast = true),
)

/**
 * Relie [live] à sa room média tant qu'il est affiché : connexion avec le jeton du `snapshot`,
 * caméra et micro publiés si l'on est Animateur, déconnexion à la fin du Live.
 */
@Composable
internal fun rememberLiveRoom(live: Live): Room {
    val context = LocalContext.current
    val room = remember(live) { newRoom(context) }
    val state by live.state.collectAsState()
    val ended = state.connection.isFinal
    // Seul l'Hôte publie pour l'instant ; la montée des Co-hôtes viendra avec les Demandes de montée.
    val publishing = state.live?.role == Role.Host

    LaunchedEffect(room, ended) {
        if (ended) {
            room.disconnect()
            return@LaunchedEffect
        }
        // LiveKit se reconnecte seul aux coupures courtes ; après une vraie déconnexion,
        // on revient avec le jeton du dernier `snapshot`.
        while (true) {
            val access = live.media.first { it != null }!!
            try {
                room.connect(access.url, access.token)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                delay(RETRY_DELAY)
                continue
            }
            room::state.flow.first { it == Room.State.DISCONNECTED }
            delay(RETRY_DELAY)
        }
    }
    LaunchedEffect(room, publishing, ended) {
        if (ended) return@LaunchedEffect
        // À chaque (re)connexion de la room : une nouvelle connexion repart sans piste publiée.
        room::state.flow.collect { roomState ->
            if (roomState == Room.State.CONNECTED) {
                runCatching {
                    room.localParticipant.setCameraEnabled(publishing)
                    room.localParticipant.setMicrophoneEnabled(publishing)
                }
            }
        }
    }
    DisposableEffect(room) {
        onDispose {
            room.disconnect()
            room.release()
        }
    }
    return room
}

private val RETRY_DELAY = 2.seconds

/** Les fins définitives : plus de média à afficher. */
internal val LiveState.Connection.isFinal: Boolean
    get() = when (this) {
        LiveState.Connection.Connecting, LiveState.Connection.Connected, is LiveState.Connection.Reconnecting -> false
        else -> true
    }

/** La caméra de [identity] dans [room] : la nôtre si c'est nous, sinon celle reçue. */
@OptIn(ExperimentalCoroutinesApi::class)
@Composable
internal fun rememberCameraTrack(room: Room, identity: String?, isYou: Boolean): State<VideoTrack?> {
    val flow = remember(room, identity, isYou) {
        val participant: Flow<Participant?> = when {
            identity == null -> flowOf(null)
            isYou -> flowOf(room.localParticipant)
            else -> room::remoteParticipants.flow.map { it[Participant.Identity(identity)] }
        }
        participant.flatMapLatest { p ->
            p?.let { it::videoTrackPublications.flow }
                ?.map { tracks ->
                    tracks.firstOrNull { (publication, _) -> publication.source == Track.Source.CAMERA }?.second as? VideoTrack
                }
                ?: flowOf(null)
        }
    }
    return flow.collectAsState(initial = null)
}

/** Affiche [track] en remplissant la zone ; miroir pour notre propre caméra frontale. */
@Composable
internal fun VideoTrackView(room: Room, track: VideoTrack?, mirror: Boolean, modifier: Modifier = Modifier) {
    var renderer by remember(room) { mutableStateOf<TextureViewRenderer?>(null) }
    // Un renderer est lié à l'EGL de sa room : nouvelle room, nouveau renderer.
    key(room) {
        AndroidView(
            factory = { context ->
                TextureViewRenderer(context).also {
                    room.initVideoRenderer(it)
                    it.setScalingType(ScalingType.SCALE_ASPECT_FILL)
                    renderer = it
                }
            },
            update = { it.setMirror(mirror) },
            onRelease = { it.release() },
            modifier = modifier,
        )
    }
    val view = renderer
    DisposableEffect(track, view) {
        if (track == null || view == null) return@DisposableEffect onDispose {}
        val visibility = (track as? RemoteVideoTrack)?.let { ViewVisibility(view).also { v -> it.addRenderer(view, v) } }
        if (visibility == null) track.addRenderer(view)
        onDispose {
            track.removeRenderer(view)
            visibility?.close()
        }
    }
}

/** Aperçu caméra local, hors de toute room connectée (écran de lancement). */
@Composable
internal fun CameraPreview(enabled: Boolean, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val room = remember { newRoom(context) }
    var track by remember { mutableStateOf<LocalVideoTrack?>(null) }
    DisposableEffect(room, enabled) {
        val created = if (enabled) {
            runCatching { room.localParticipant.createVideoTrack().apply { startCapture() } }.getOrNull()
        } else {
            null
        }
        track = created
        onDispose {
            track = null
            created?.stopCapture()
            created?.dispose()
        }
    }
    DisposableEffect(room) { onDispose { room.release() } }
    VideoTrackView(room, track, mirror = true, modifier = modifier)
}
