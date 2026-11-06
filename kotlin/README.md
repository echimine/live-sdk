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
| `LiveScreen(liveId, onClose, productSource = …)` / `LiveScreen(live, onClose, productSource = …)` | Le Live en plein écran : mosaïque portrait jusqu'à 6 (1 plein écran, 2 empilées, 2 × 2, 2 × 3 ; Hôte en haut à gauche puis Co-hôtes par ordre de montée, chaque tuile reçue dans la qualité adaptée à sa taille), barre du haut (libellé du Live, 👁 Audience → feuille par App d'origine, ✕), bandeaux « Hôte déconnecté » / « Hôte revenu », pastille du Produit épinglé → fiche avec « Confirmer l'achat », 2 derniers messages, dock (💬 chat en feuille mi-hauteur, ❤️ Réaction rapide / appui long, 😀 toutes les Réactions, 🛍 produit, ✋ Demande de montée, ⚙️ Gestion pour les Animateurs), Réactions de tous en animation, Annonces d'achat dans le chat et en toast, refus d'une Demande de montée en toast. Les Animateurs épinglent, changent ou retirent le produit depuis 🛍. ✋ : le Spectateur demande à monter (caméra et micro autorisés d'abord) ou annule, le Co-hôte redescend. ⚙️ Gestion (badge = Demandes de montée en attente) : l'Hôte accepte ou refuse les demandes et retire les Co-hôtes, avec la limite de 5 Co-hôtes affichée. Pour l'Hôte, ✕ propose de terminer le Live puis affiche le récapitulatif de fin (Achats, Réactions, Audience max.) ; pour les autres, la fin du Live s'annonce avec « Fermer » |

Sans les écrans, le cœur suffit : `live.sendMessage(text)` refuse un message vide ou trop long
(`InvalidMessage`) sans rien envoyer, et verrouille le chat après un `rate_limited`
(`live.state.value.chatLocked`, le temps indiqué) ; `live.react(emoji)` n'envoie qu'un emoji de
`live.config.value.reactions` et l'anime aussitôt via `live.events`.

`client.startLive(title)` alors qu'un Live de cet Hôte est déjà en cours rend ce Live (reprise après
un crash). `live.endLive()` le termine pour tous : la fin arrive dans `live.state` (`Connection.Ended`),
avec `summary` pour l'Hôte seul. L'Audience est dans `live.state.value.live?.audience`
(`audience.ranked` : par App d'origine, de la plus présente à la moins présente).

## Co-hôtes

Sans les écrans : `live.requestToJoin()` puis `live.cancelJoinRequest()` pour le Spectateur
(`live.state.value.live?.requestedToJoin`, effacé à la montée, au refus — annoncé par `LiveEvent.JoinDeclined` — ou à
une reconnexion), `live.leaveStage()` pour le Co-hôte, `acceptJoin(id)`, `declineJoin(id)` et `removeCohost(id)`
pour l'Hôte (`CohostLimit` au-delà de `MAX_COHOSTS`). `live.state.value.live?.stage` donne l'ordre de la
mosaïque. À la montée, le serveur ouvre la publication sans nouveau jeton : `LiveScreen` allume caméra et
micro dans la room déjà connectée, et les éteint à la descente.

## Produit épinglé et Source de produits

Un Animateur épingle un produit saisi à la main (nom, prix, devise, photo prise ou choisie) ou, si
votre app fournit une Source de produits, trouvé dans votre catalogue :

```kotlin
val catalog = ProductSource { query ->
    myApi.search(query).map { ProductSuggestion(it.sku, it.name, it.priceCents, it.currency, it.imageUrl) }
}
LiveScreen(liveId, onClose = { … }, productSource = catalog)
```

La recherche part 300 ms après la dernière frappe (la précédente est annulée), attend 5 s au plus,
garde 20 résultats au plus et écarte ceux que le serveur commun refuserait (nom vide ou > 80, prix
hors de 0 à 1 000 000 centimes, devise non ISO, image non https). Un résultat préremplit le formulaire ;
`id` ne quitte jamais votre app. Si la recherche échoue (exception ou délai dépassé), l'écran affiche
« Catalogue indisponible » et « Réessayer » ; la saisie manuelle reste possible. Les prix s'affichent
selon la locale du téléphone.

Sans les écrans : `live.pinProduct(name, priceCents, currency, ProductImage.Url(https))` transmet
l'URL telle quelle ; `ProductImage.Data(bytes)` réduit la photo (1024 px au plus, JPEG) puis l'envoie
via `POST /v1/images`. Un produit invalide est refusé sans rien envoyer (`InvalidProduct`), une photo
illisible aussi (`InvalidImage`). `live.purchase(productId)` répond `ProductChanged` si l'Animateur a
changé de produit entre-temps ; chaque Achat arrive dans le chat (`ChatMessage.Purchase`) et dans
`live.events` (`LiveEvent.PurchaseAnnounced`).

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
