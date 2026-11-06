package fr.echimine.live.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.echimine.live.core.LiveClient
import fr.echimine.live.core.LiveResult
import fr.echimine.live.core.LiveSdk
import fr.echimine.live.core.LiveSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.seconds

/**
 * Liste compacte des Lives en cours de toutes les App membres, par Audience décroissante,
 * avec un champ de lien direct. [onLaunch] affiche le bouton « Lancer un Live » s'il est fourni.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun LiveListScreen(
    onOpenLive: (liveId: String) -> Unit,
    modifier: Modifier = Modifier,
    onLaunch: (() -> Unit)? = null,
    client: LiveClient = LiveSdk.client,
) {
    var lives by remember { mutableStateOf<List<LiveSummary>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        when (val result = client.lives()) {
            is LiveResult.Success -> {
                lives = result.value
                error = null
            }
            is LiveResult.Failure -> error = result.error.displayMessage()
        }
    }
    LaunchedEffect(client) {
        while (true) {
            load()
            delay(REFRESH_EVERY)
        }
    }

    LiveSdkTheme {
        Column(
            modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding(),
        ) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    LocalLiveTheme.current.label,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.weight(1f),
                )
                if (onLaunch != null) Button(onClick = onLaunch) { Text("Lancer un Live") }
            }
            DirectLink(onOpenLive)
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        load()
                        refreshing = false
                    }
                },
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) {
                val current = lives
                when {
                    current == null && error != null -> Message(error!!) {
                        scope.launch { load() }
                    }
                    current == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { Text("Chargement…") }
                    current.isEmpty() -> Message("Aucun Live en cours pour l'instant.", null)
                    else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                        items(current, key = { it.id }) { live ->
                            LiveRow(live) { onOpenLive(live.id) }
                            HorizontalDivider(Modifier.padding(start = 72.dp))
                        }
                    }
                }
            }
        }
    }
}

private val REFRESH_EVERY = 15.seconds

@Composable
private fun DirectLink(onOpenLive: (String) -> Unit) {
    var input by remember { mutableStateOf("") }
    val id = liveIdFrom(input)
    val open = { id?.let(onOpenLive); Unit }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = input,
            onValueChange = { input = it },
            placeholder = { Text("Lien ou identifiant d'un Live") },
            singleLine = true,
            shape = MaterialTheme.shapes.medium,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { open() }),
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        OutlinedButton(onClick = open, enabled = id != null) { Text("Ouvrir") }
    }
}

@Composable
private fun LiveRow(live: LiveSummary, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ParticipantLine(
            live.host,
            modifier = Modifier.weight(1f),
            avatarSize = 44.dp,
            headline = live.title ?: "Live de ${live.host.name}",
        )
        Text(
            "👁 ${live.audience}",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 13.sp,
        )
    }
}

@Composable
private fun Message(text: String, onRetry: (() -> Unit)?) {
    // Défilable pour que le tirer-pour-rafraîchir fonctionne aussi sur l'état vide.
    LazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        item {
            Column(Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (onRetry != null) TextButton(onClick = onRetry) { Text("Réessayer") }
            }
        }
    }
}
