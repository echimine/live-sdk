# SDK Live Swift (iOS 17+)

Deux bibliothèques : `LiveSDK` (cœur sans interface : config, liste, lancement, Live observable,
commandes) et `LiveSDKUI` (écrans SwiftUI prêts à l'emploi, qui affichent la vidéo).

```swift
// Package.swift de l'app, ou Xcode › Add Package Dependencies
.package(url: "https://github.com/echimine/live-sdk.git", from: "X.Y.Z")
// produits : LiveSDK, LiveSDKUI
```

## Démarrer

```swift
await LiveSDK.shared.configure(serverURL: URL(string: "https://live.echimine.fr")!) {
    // Jeton de Participant frais, signé par votre backend (POST /live/participant-token).
    try await myBackend.participantToken()
}
```

## Écrans

| Écran | Rôle |
| --- | --- |
| `LiveListScreen(onOpenLive:onLaunch:)` | Lives en cours de toutes les App membres (titre, Hôte, App d'origine, Audience) + champ de lien direct |
| `LiveLaunchScreen(onLaunched:onClose:)` | Aperçu caméra, vérifications (caméra, micro, serveur), titre facultatif ≤ 80, « Lancer » |
| `LiveScreen(liveId:onClose:)` / `LiveScreen(session:onClose:)` | Le Live en plein écran : vidéo de l'Hôte, barre du haut (libellé du Live, ✕), 2 derniers messages, dock (💬 chat en feuille mi-hauteur, ❤️ Réaction rapide / appui long, 😀 toutes les Réactions), Réactions de tous en animation |

La navigation reste à votre app : chaque écran rend la main par ses callbacks.
`LiveLink.liveId(from:)` extrait l'identifiant d'un lien collé, pour brancher vos propres liens.

Sans les écrans, le cœur suffit : `try await LiveSDK.shared.openLive(id:)` rend une `LiveSession`
observable (`status`, `role`, `host`, `audience`, `messages`…) et `session.send(_:)` envoie une
commande typée (succès sur `ack`, sinon `LiveCommandError` à code fermé).
`session.sendMessage(_:)` refuse un message vide ou trop long (`invalid_message`) sans rien envoyer,
et verrouille le chat après un `rate_limited` (`session.chatLocked`, le temps indiqué) ;
`session.react(_:)` n'envoie qu'un emoji de `session.config.reactions` et l'anime aussitôt via
`session.events()`.

## Thème

```swift
LiveListScreen(onOpenLive: { … })
    .liveTheme(LiveTheme(
        accent: .purple,
        cornerRadius: 14,
        fontName: nil,      // police système ; sinon le nom d'une police embarquée
        label: "Crosslive"  // libellé du Live, valeur par défaut
    ))
```

Clair ou sombre suit le système. Sans avatar, un Participant est affiché par l'initiale de son pseudo.

## Permissions

Ajoutez à l'`Info.plist` de votre app les textes recommandés (`LivePermissionTexts`) :

- `NSCameraUsageDescription` : « La caméra sert à vous filmer pendant votre Live ou quand vous montez à l'écran. Rien n'est enregistré. »
- `NSMicrophoneUsageDescription` : « Le micro sert à vous faire entendre pendant votre Live ou quand vous montez à l'écran. Rien n'est enregistré. »

L'écran de lancement explique pourquoi avant de demander les autorisations.
Pour qu'un Live continue écran verrouillé, activez les modes d'arrière-plan `audio` et `voip`.

## Essayer en local

Voir [`Sample/README.md`](Sample/README.md) : l'app d'exemple, App membre de test `demo-ios`.
