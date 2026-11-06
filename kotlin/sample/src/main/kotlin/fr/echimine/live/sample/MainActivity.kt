package fr.echimine.live.sample

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import fr.echimine.live.core.Live
import fr.echimine.live.core.LiveSdk
import fr.echimine.live.ui.LiveLaunchScreen
import fr.echimine.live.ui.LiveListScreen
import fr.echimine.live.ui.LiveScreen
import fr.echimine.live.ui.LiveSdkTheme
import fr.echimine.live.ui.LiveTheme
import java.util.UUID

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val profile = Profile(getSharedPreferences("demo", Context.MODE_PRIVATE))
        if (profile.name != null) configure(profile)
        setContent {
            // Les 4 jetons de thème, tels qu'une App membre les régle.
            LiveSdkTheme(LiveTheme(accent = Color(0xFF6C4DFF), label = "Crosslive")) {
                DemoApp(profile)
            }
        }
    }
}

private sealed interface Screen {
    data object List : Screen
    data object Launch : Screen
    data class Watch(val liveId: String) : Screen
    data class Host(val live: Live) : Screen
}

@Composable
private fun DemoApp(profile: Profile) {
    var name by rememberSaveable { mutableStateOf(profile.name) }
    if (name == null) {
        NameScreen { chosen ->
            profile.name = chosen
            configure(profile)
            name = chosen
        }
        return
    }
    var screen by remember { mutableStateOf<Screen>(Screen.List) }
    BackHandler(enabled = screen != Screen.List) { screen = Screen.List }
    when (val current = screen) {
        Screen.List -> LiveListScreen(
            onOpenLive = { screen = Screen.Watch(it) },
            onLaunch = { screen = Screen.Launch },
        )
        Screen.Launch -> LiveLaunchScreen(
            onLaunched = { screen = Screen.Host(it) },
            onClose = { screen = Screen.List },
        )
        is Screen.Watch -> LiveScreen(current.liveId, onClose = { screen = Screen.List }, productSource = DemoProductSource)
        is Screen.Host -> LiveScreen(current.live, onClose = { screen = Screen.List }, productSource = DemoProductSource)
    }
}

private fun configure(profile: Profile) {
    LiveSdk.configure(
        serverUrl = BuildConfig.SERVER_URL,
        tokenProvider = {
            DemoParticipantToken.sign(BuildConfig.APP_ID, BuildConfig.TOKEN_SECRET, profile.userId, profile.name!!)
        },
    )
}

@Composable
private fun NameScreen(onDone: (String) -> Unit) {
    var input by remember { mutableStateOf("") }
    val valid = input.trim().length in 1..30
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Text("App membre de test « ${BuildConfig.APP_ID} »", style = MaterialTheme.typography.titleLarge)
        Text("Choisissez un pseudo : il identifie ce téléphone dans les Lives.")
        OutlinedTextField(
            value = input,
            onValueChange = { input = it.take(30) },
            label = { Text("Pseudo") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(onClick = { onDone(input.trim()) }, enabled = valid, modifier = Modifier.fillMaxWidth()) {
            Text("Continuer")
        }
    }
}

/** Identité de démo de ce téléphone : un identifiant tiré au hasard et un pseudo. */
private class Profile(private val prefs: android.content.SharedPreferences) {
    val userId: String = prefs.getString("userId", null)
        ?: UUID.randomUUID().toString().also { prefs.edit().putString("userId", it).apply() }

    var name: String?
        get() = prefs.getString("name", null)
        set(value) = prefs.edit().putString("name", value).apply()
}
