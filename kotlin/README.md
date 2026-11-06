# SDK Live Kotlin (Android API 26+)

Deux modules : `core` (sans interface : liste, lancement, Live observable, commandes) et `ui`
(écrans Jetpack Compose prêts à l'emploi, qui embarquent la vidéo).

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://jitpack.io")
    }
}

// build.gradle.kts de l'app
dependencies {
    implementation("com.github.echimine.live-sdk:ui:X.Y.Z") // tire aussi :core
}
```

## Démarrer

```kotlin
LiveSdk.configure(
    serverUrl = "https://live.echimine.fr",
    // Jeton de Participant frais, signé par votre backend (POST /live/participant-token).
    tokenProvider = { myBackend.participantToken() },
)
```

## Écrans

| Écran | Rôle |
| --- | --- |
| `LiveListScreen(onOpenLive, onLaunch)` | Lives en cours de toutes les App membres (titre, Hôte, App d'origine, Audience) + champ de lien direct |
| `LiveLaunchScreen(onLaunched, onClose)` | Aperçu caméra, vérifications (caméra, micro, serveur), titre facultatif ≤ 80, « Lancer » |
| `LiveScreen(liveId, onClose)` / `LiveScreen(live, onClose)` | Le Live en plein écran : vidéo, barre du haut (libellé du Live, 👁 Audience → feuille par App d'origine, ✕), bandeaux « Hôte déconnecté » / « Hôte revenu », 2 derniers messages, dock (💬 chat en feuille mi-hauteur, ❤️ Réaction rapide / appui long, 😀 toutes les Réactions), Réactions de tous en animation. Pour l'Hôte, ✕ propose de terminer le Live puis affiche le récapitulatif de fin (Achats, Réactions, Audience max.) ; pour les autres, la fin du Live s'annonce avec « Fermer » |

Sans les écrans, le cœur suffit : `live.sendMessage(text)` refuse un message vide ou trop long
(`InvalidMessage`) sans rien envoyer, et verrouille le chat après un `rate_limited`
(`live.state.value.chatLocked`, le temps indiqué) ; `live.react(emoji)` n'envoie qu'un emoji de
`live.config.value.reactions` et l'anime aussitôt via `live.events`.

`client.startLive(title)` alors qu'un Live de cet Hôte est déjà en cours rend ce Live (reprise après
un crash). `live.endLive()` le termine pour tous : la fin arrive dans `live.state` (`Connection.Ended`),
avec `summary` pour l'Hôte seul. L'Audience est dans `live.state.value.live?.audience`
(`audience.ranked` : par App d'origine, de la plus présente à la moins présente).

La navigation reste à votre app : chaque écran rend la main par ses callbacks.
`liveIdFrom(text)` extrait l'identifiant d'un lien collé, pour brancher vos propres liens.

## Thème

```kotlin
LiveSdkTheme(
    LiveTheme(
        accent = Color(0xFF6C4DFF),
        cornerRadius = 14.dp,
        fontFamily = FontFamily.Default,
        label = "Crosslive", // libellé du Live, valeur par défaut
    ),
) {
    LiveListScreen(onOpenLive = { … })
}
```

Clair ou sombre suit le système. Sans avatar, un Participant est affiché par l'initiale de son pseudo.

## Permissions

Le module `ui` déclare `CAMERA`, `RECORD_AUDIO` et `INTERNET` (via LiveKit). L'écran de lancement
affiche d'abord pourquoi, avec les textes recommandés de `LivePermissionTexts`, puis demande les
permissions quand le Participant touche « Autoriser la caméra et le micro » :

- **Caméra** : « La caméra sert à vous filmer pendant votre Live ou quand vous montez à l'écran. Rien n'est enregistré. »
- **Micro** : « Le micro sert à vous faire entendre pendant votre Live ou quand vous montez à l'écran. Rien n'est enregistré. »

Reprenez-les dans la section « Sécurité des données » de votre fiche Play Store.

## Essayer en local

Voir [`sample/README.md`](sample/README.md) : l'app d'exemple, App membre de test `demo-android`.
