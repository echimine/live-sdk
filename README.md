# Live SDK — guide d'intégration des App membres

Outil live commun aux apps clones (TikTok_Clone, twitch, clone_instagram, snapcore, clone-strava) :
un **serveur commun** (`https://live.echimine.fr`) avec LiveKit pour le média, un **SDK Swift**
(iOS 17+) et un **SDK Kotlin** (Android API 26+). Vocabulaire : [`GLOSSARY.md`](GLOSSARY.md).

Une fois le SDK intégré, chaque utilisateur de votre app voit la liste des Lives en cours de toutes
les App membres, en rejoint un ou lance le sien, discute, réagit, achète le Produit épinglé et monte
à l'écran comme Co-hôte, quelle que soit son App d'origine. Les deux SDK sont publiés ensemble sous
un même tag semver `X.Y.Z` ([Releases](https://github.com/echimine/live-sdk/releases)).

| Dossier | Contenu |
| --- | --- |
| [`swift/`](swift/README.md) | SDK Swift : `LiveSDK` (cœur) + `LiveSDKUI` (écrans SwiftUI) + app d'exemple |
| [`kotlin/`](kotlin/README.md) | SDK Kotlin : `core` + `ui` (écrans Compose) + app d'exemple |
| [`examples/participant-token/`](examples/participant-token/README.md) | L'endpoint à ajouter à votre backend, en Node avec `jose` |
| [`protocol/`](protocol/README.md) | Contrat (fixtures JSON) entre le serveur commun et les SDK |
| `server/` | Le serveur commun (déployé en continu depuis `main`) |

## 1. Signer un Jeton de Participant (backend)

Chaque App membre garde ses comptes. Votre backend ajoute un endpoint pour l'utilisateur connecté :

```
POST /live/participant-token  →  200 { "token": "<JWT>" }
```

Le jeton est un JWT **HS256**, signé avec le secret de votre App membre (généré et transmis en privé
par echimine, jamais commité) :

| Claim | Valeur |
| --- | --- |
| `iss` | identifiant de votre App membre : `tiktok`, `twitch`, `instagram`, `snapcore`, `strava` |
| `sub` | identifiant de l'utilisateur dans votre app |
| `name` | pseudo, 1 à 30 caractères visibles |
| `picture` | avatar en `https://`, facultatif (sinon l'initiale du pseudo est affichée) |
| `iat` / `exp` | émission et expiration : **5 min au plus** |

Aucun rôle dans le jeton : le serveur commun décide seul qui est Hôte, Co-hôte ou Spectateur.
Un jeton est refusé si l'émetteur est inconnu, la signature ne correspond pas, il est expiré ou
trop long, ou `name` est hors limites. Exemple complet : [`examples/participant-token`](examples/participant-token/README.md).

## 2. Ajouter le SDK

**Swift** (Swift Package, Xcode › Add Package Dependencies ou `Package.swift`) :

```swift
.package(url: "https://github.com/echimine/live-sdk.git", from: "0.1.0")
// produits : LiveSDK (cœur), LiveSDKUI (écrans)
```

**Kotlin** (JitPack) :

```kotlin
// settings.gradle.kts
dependencyResolutionManagement { repositories { google(); mavenCentral(); maven("https://jitpack.io") } }
// build.gradle.kts
dependencies { implementation("com.github.echimine.live-sdk:ui:0.1.0") } // tire aussi :core
```

Dependabot propose les mises à jour : ajoutez l'écosystème `swift` ou `gradle` à votre
`.github/dependabot.yml`.

## 3. Configurer avec un `tokenProvider`

Le SDK appelle votre fonction à chaque connexion et reconnexion : rendez un jeton **frais** à chaque
appel, sans le mettre en cache.

```swift
await LiveSDK.shared.configure(serverURL: URL(string: "https://live.echimine.fr")!) {
    try await myBackend.participantToken() // POST /live/participant-token
}
```

```kotlin
LiveSdk.configure(
    serverUrl = "https://live.echimine.fr",
    tokenProvider = { myBackend.participantToken() },
)
```

La config pilotée par le serveur (jeu de Réactions, longueurs maximales…) est chargée au démarrage,
rechargée avant d'ouvrir un Live si elle a plus de 5 min, et remplacée par des valeurs par défaut
embarquées si le serveur ne répond pas.

## 4. Brancher les écrans

Trois écrans prêts à l'emploi, la navigation reste à votre app (chaque écran rend la main par ses
callbacks) :

| Écran | Swift | Kotlin |
| --- | --- | --- |
| Liste des Lives + lien direct | `LiveListScreen(onOpenLive:onLaunch:)` | `LiveListScreen(onOpenLive, onLaunch)` |
| Lancer un Live (aperçu caméra, vérifications, titre) | `LiveLaunchScreen(onLaunched:onClose:)` | `LiveLaunchScreen(onLaunched, onClose)` |
| Le Live en plein écran | `LiveScreen(liveId:onClose:)` | `LiveScreen(liveId, onClose)` |

**Ouvrir un Live par identifiant** pour vos propres liens et boutons : `LiveScreen(liveId:)` /
`LiveScreen(liveId)` ; `LiveLink.liveId(from:)` / `liveIdFrom(text)` extrait l'identifiant d'un lien
collé. Sans les écrans, le cœur expose un état observable et des commandes typées (voir le README de
chaque SDK).

## 5. Thème

Quatre jetons : accent, arrondi, police, libellé du Live (« Crosslive » par défaut). Clair ou sombre
suit le système.

```swift
LiveListScreen(onOpenLive: { … })
    .liveTheme(LiveTheme(accent: .purple, cornerRadius: 14, fontName: nil, label: "Crosslive"))
```

```kotlin
LiveSdkTheme(LiveTheme(accent = Color(0xFF6C4DFF), cornerRadius = 14.dp, fontFamily = FontFamily.Default, label = "Crosslive")) {
    LiveListScreen(onOpenLive = { … })
}
```

## 6. Permissions caméra et micro

Textes recommandés (`LivePermissionTexts`), à reprendre tels quels pour la revue des stores :

- **Caméra** : « La caméra sert à vous filmer pendant votre Live ou quand vous montez à l'écran. Rien n'est enregistré. »
- **Micro** : « Le micro sert à vous faire entendre pendant votre Live ou quand vous montez à l'écran. Rien n'est enregistré. »

iOS : `NSCameraUsageDescription` et `NSMicrophoneUsageDescription` dans l'`Info.plist`, modes
d'arrière-plan `audio` et `voip` pour qu'un Live continue écran verrouillé. Android : `CAMERA`,
`RECORD_AUDIO` et `INTERNET` sont déclarés par le module `ui` (via LiveKit) ; l'écran de lancement
demande les permissions après avoir expliqué pourquoi.

## 7. Source de produits (facultatif)

Si votre app a un catalogue, les Animateurs peuvent y chercher un produit pour préremplir le Produit
épinglé. Le serveur commun ne connaît jamais votre catalogue ; `id` ne quitte pas votre app.

```swift
struct MyCatalog: ProductSource {
    func searchProducts(matching query: String) async throws -> [ProductSuggestion] { … }
}
LiveScreen(liveId: id, onClose: { … }).productSource(MyCatalog())
```

```kotlin
val catalog = ProductSource { query -> myApi.search(query).map { ProductSuggestion(it.sku, it.name, it.priceCents, it.currency, it.imageUrl) } }
LiveScreen(liveId, onClose = { … }, productSource = catalog)
```

Recherche 300 ms après la dernière frappe, précédente annulée, 5 s au plus, 20 résultats au plus,
résultats invalides écartés. Une exception affiche « Catalogue indisponible » et « Réessayer » ; la
saisie manuelle reste toujours possible.

## 8. Essayer en local

`docker compose up` lance Postgres et LiveKit ; `cd server && pnpm dev` le serveur commun avec les
App membres de test de `server/member-apps.example.json` (`demo-ios`, `demo-android`). Les apps
d'exemple [`swift/Sample`](swift/Sample/README.md) et [`kotlin/sample`](kotlin/sample/README.md)
sont branchées dessus, avec une Source de produits factice.

## Pour echimine

Le serveur commun est déployé à chaque push sur `main` (image GHCR par SHA → webhook du VPS, voir
`deploy/`). Les SDK sont publiés par un tag `X.Y.Z` (`.github/workflows/release.yml` : tests des
trois langages, GitHub Release, construction JitPack). `GET /health` et `GET /admin/state` (protégé
par `ADMIN_TOKEN`) servent à vérifier l'état avant et pendant la démo.
