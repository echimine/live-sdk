package fr.echimine.live.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import fr.echimine.live.core.Live
import fr.echimine.live.core.LiveClient
import fr.echimine.live.core.visibleLength
import fr.echimine.live.core.LiveResult
import fr.echimine.live.core.LiveSdk
import kotlinx.coroutines.launch

/** Longueur maximale du titre d'un Live, en caractères visibles. */
private const val TITLE_MAX = 80

/**
 * Prépare et lance un Live : aperçu caméra, vérifications (caméra, micro, serveur commun),
 * titre facultatif (80 caractères au plus) et « Lancer ». [onLaunched] reçoit le Live ouvert,
 * à afficher avec [LiveScreen].
 */
@Composable
public fun LiveLaunchScreen(
    onLaunched: (Live) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    client: LiveClient = LiveSdk.client,
) {
    val context = LocalContext.current
    var camera by remember { mutableStateOf(context.granted(Manifest.permission.CAMERA)) }
    var microphone by remember { mutableStateOf(context.granted(Manifest.permission.RECORD_AUDIO)) }
    var askedOnce by remember { mutableStateOf(false) }
    val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        camera = context.granted(Manifest.permission.CAMERA)
        microphone = context.granted(Manifest.permission.RECORD_AUDIO)
        askedOnce = true
    }
    val askPermissions = {
        permissions.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
    }

    var server by remember { mutableStateOf<Check>(Check.Pending) }
    var serverAttempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(client, serverAttempt) {
        server = Check.Pending
        // Une liste obtenue prouve que le serveur répond et que le Jeton de Participant est accepté.
        server = when (val result = client.lives()) {
            is LiveResult.Success -> Check.Ok
            is LiveResult.Failure -> Check.Failed(result.error.message)
        }
    }

    var title by remember { mutableStateOf("") }
    var launching by remember { mutableStateOf(false) }
    var launchError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val ready = camera && microphone && server == Check.Ok && !launching

    LiveSdkTheme {
        Box(modifier.fillMaxSize().background(Color.Black)) {
            CameraPreview(enabled = camera, modifier = Modifier.fillMaxSize())
            Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        LocalLiveTheme.current.label,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        modifier = Modifier.weight(1f),
                    )
                    CloseButton("Fermer", onClose)
                }
                Spacer(Modifier.weight(1f))
                Panel {
                    CheckRow("Caméra", if (camera) Check.Ok else Check.Failed(LivePermissionTexts.CAMERA))
                    CheckRow("Micro", if (microphone) Check.Ok else Check.Failed(LivePermissionTexts.MICROPHONE))
                    CheckRow("Serveur", server)
                    if (!camera || !microphone) {
                        TextButton(onClick = askPermissions) {
                            Text(if (askedOnce) "Autoriser à nouveau" else "Autoriser la caméra et le micro")
                        }
                    }
                    if (server is Check.Failed) {
                        TextButton(onClick = { serverAttempt++ }) { Text("Réessayer la connexion") }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = limitGraphemes(it, TITLE_MAX) },
                        label = { Text("Titre (facultatif)") },
                        supportingText = { Text("${visibleLength(title)} / $TITLE_MAX") },
                        singleLine = true,
                        shape = MaterialTheme.shapes.medium,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedLabelColor = Color.White,
                            unfocusedLabelColor = Color.White.copy(alpha = 0.7f),
                            focusedSupportingTextColor = Color.White.copy(alpha = 0.7f),
                            unfocusedSupportingTextColor = Color.White.copy(alpha = 0.7f),
                            unfocusedBorderColor = Color.White.copy(alpha = 0.5f),
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    launchError?.let { Text(it, color = ErrorColor, fontSize = 13.sp) }
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = {
                            launching = true
                            launchError = null
                            scope.launch {
                                when (val result = client.startLive(title.trim().ifEmpty { null })) {
                                    is LiveResult.Success -> onLaunched(result.value)
                                    is LiveResult.Failure -> launchError = result.error.message
                                }
                                launching = false
                            }
                        },
                        enabled = ready,
                        shape = MaterialTheme.shapes.medium,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) { Text(if (launching) "Lancement…" else "Lancer", fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}

private val ErrorColor = Color(0xFFFF8A80)

private sealed interface Check {
    data object Pending : Check
    data object Ok : Check
    data class Failed(val reason: String) : Check
}

@Composable
private fun Panel(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(LocalLiveTheme.current.cornerRadius))
            .background(Color.Black.copy(alpha = 0.55f))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) { content() }
}

@Composable
private fun CheckRow(label: String, check: Check) {
    Row(verticalAlignment = Alignment.Top) {
        val (mark, color) = when (check) {
            Check.Pending -> "…" to Color.White
            Check.Ok -> "✓" to Color(0xFF69F0AE)
            is Check.Failed -> "✕" to ErrorColor
        }
        Text(mark, color = color, fontWeight = FontWeight.Bold, modifier = Modifier.width(22.dp))
        Column {
            Text(label, color = Color.White, fontWeight = FontWeight.SemiBold)
            if (check is Check.Failed) Text(check.reason, color = Color.White.copy(alpha = 0.75f), fontSize = 12.sp)
        }
    }
}

private fun Context.granted(permission: String): Boolean =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
