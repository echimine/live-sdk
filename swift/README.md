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
| `LiveScreen(liveId:onClose:)` / `LiveScreen(session:onClose:)` | Le Live en plein écran : mosaïque de l'Hôte et des Co-hôtes, barre du haut (libellé du Live, Audience par App d’origine, ✕), 2 derniers messages, dock (💬 chat en feuille mi-hauteur, ❤️ Réaction rapide / appui long, 😀 toutes les Réactions), Réactions de tous en animation |

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

## Audience et fin du Live

L’Audience de la barre du haut ouvre une feuille mise à jour en temps réel, classée par nombre de Spectateurs puis par nom d’App d’origine. Les nombres suivent la locale du téléphone.

Les Participants voient « Hôte déconnecté » pendant l’absence puis « Hôte revenu » pendant trois secondes. Leur propre reconnexion prend la priorité. Arriver avec un Hôte déjà présent ne montre pas de faux retour.

L’Hôte confirme « Terminer le Live ». Une erreur permet de réessayer ; un acquittement seul ne ferme pas l’écran. À la fin reçue du serveur, la feuille récapitulative présente Achats, Réactions et Audience maximale ; Fermer appelle `onClose`. Les autres Participants voient la fin sans récapitulatif. Quitter l’écran libère la session.

`startLive(title:)` utilise le lancement idempotent du serveur : un Live en cours est rendu avec son titre initial (HTTP 200), un nouveau Live avec HTTP 201. Les deux réponses sont acceptées.

## Co-hôtes et mosaïque

La vidéo est une mosaïque portrait de 6 personnes au plus (`StageMosaic`) : 1 plein écran, 2 empilées, 2 × 2, puis 2 × 3 ; l’Hôte en haut à gauche, puis les Co-hôtes par ordre de montée (`session.stage`). La room LiveKit est en simulcast et `adaptiveStream` : chaque tuile reçoit la qualité de sa taille.

- Spectateur : ✋ demande à monter (caméra et micro autorisés d’abord), puis l’annule. `session.joinRequestPending` suit la demande ; le serveur ne signale pas un refus, et une reconnexion perd la demande.
- Acceptation : `roleChanged` publie caméra et micro dans la room déjà connectée, sans nouveau jeton ni reconnexion. Redescendre (soi-même ou retiré par l’Hôte) coupe la publication ; on reste dans le Live.
- Hôte : ⚙️ Gestion porte le nombre de Demandes de montée en attente, permet d’accepter, refuser et retirer un Co-hôte, avec le compte `n/5` (`LiveSession.maxCohosts`) ; `cohost_limit` est affiché.
- Co-hôte : « Redescendre », après confirmation.

## Vérification manuelle (iOS 17+)

La spécification #19 prévoit une vérification manuelle des écrans, sans tests UI automatisés en v1. Avec le serveur local et deux Participants :

1. Ouvrir un Live, toucher l’Audience et connecter/déconnecter des Spectateurs de plusieurs apps. Vérifier total, classement, mise à jour de la feuille et état vide.
2. Couper la connexion de l’Hôte puis le reconnecter avant 60 secondes. Vérifier les deux bandeaux ; ouvrir ensuite le Live depuis un nouveau Spectateur et vérifier l’absence de faux « Hôte revenu ».
3. Couper la connexion du Spectateur : seul le message de reconnexion doit s’afficher. Revenir au Live, puis fermer l’écran et vérifier que ses connexions sont libérées.
4. Depuis l’Hôte, annuler puis confirmer la fin. Vérifier le récapitulatif et sa fermeture ; le Spectateur doit voir la fin sans récapitulatif. Répéter avec la feuille Audience ouverte à la réception de la fin.
5. Refaire avec l’Hôte absent plus de 60 secondes : vérifier le motif de fin chez le Spectateur. Vérifier aussi le remplacement de connexion et le Bannissement.
6. Appeler deux fois `startLive` depuis le même Hôte : vérifier le même identifiant et le titre initial. Vérifier les commandes refusées et la possibilité de réessayer.
7. Co-hôtes : depuis un Spectateur, ✋ puis annuler ; vérifier le badge de ⚙️ chez l’Hôte. Redemander, accepter : la caméra du Co-hôte apparaît sans reconnexion, chez tous, à la bonne place. Monter jusqu’à 6 personnes (1, 2, 2 × 2, 2 × 3), tenter une 6e acceptation (`cohost_limit`), retirer un Co-hôte, puis faire redescendre un Co-hôte de lui-même.

Validation automatisée : `swift test`, puis `xcodebuild -scheme LiveSDK-Package -destination 'generic/platform=iOS Simulator' -quiet build`.

### Produits et achats

Le cœur expose `session.pinProduct(name:price:currency:image:)`, `unpinProduct()` et
`purchase(productId:)`. Le prix est exprimé en centimes. `ProductImage.url` transmet
une URL HTTPS de catalogue ; `.data` réduit et oriente la photo à 1 024 px maximum,
puis envoie un JPEG authentifié à `POST /v1/images` avant la commande d’épinglage.
Un échec d’envoi ne remplace pas le produit existant.

Les écrans acceptent une source facultative via `.productSource(MyProductSource())`.
Implémentez `ProductSource.searchProducts(matching:)` et renvoyez des
`ProductSuggestion` (initialiseur public). Les recherches sont différées de 300 ms,
annulées à la frappe suivante et limitées à 5 secondes et 20 résultats valides.
La saisie manuelle reste accessible en cas d’erreur. La fiche conserve l’identifiant
présenté lors de son ouverture : `product_changed` invite à rouvrir le nouveau produit.
Les achats sont simulés ; annonces et prix utilisent la locale du téléphone.
