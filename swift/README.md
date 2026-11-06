# SDK Swift — Audience et cycle de vie

Le cœur `LiveSDK` expose l’Audience (`session.audience.total`, `byApp`), la présence de l’Hôte (`hostConnected`) et l’état de connexion (`status`). Après `liveEnded`, les connexions WebSocket et média sont fermées sans reconnexion. Le récapitulatif transmis à l’Hôte se trouve dans `.ended(reason, recap)`.

`startLive(title:)` appelle le lancement idempotent du serveur : si cet Hôte possède déjà un Live en cours, le serveur rend ce Live (HTTP 200), avec son titre initial. Un nouveau Live renvoie HTTP 201. Le SDK accepte ces deux réponses.

## Intégrer les écrans

```swift
import LiveSDK
import LiveSDKUI
import SwiftUI

// Après configure puis openLive(id:), conserver la session dans l’état de l’app.
LiveScreen(session: session, onClose: { dismiss() }) {
    // Placer ici la vue vidéo de l’App membre.
    Color.black
}
```

`LiveScreen` affiche l’Audience dans sa barre du haut et sa répartition par App d’origine dans une feuille. La feuille suit les mises à jour du serveur et trie les apps par Audience décroissante, puis par nom en cas d’égalité. Les nombres suivent la locale du téléphone.

Les Participants voient « Hôte déconnecté » pendant l’absence puis « Hôte revenu » pendant trois secondes. Leur propre reconnexion prend la priorité. Une arrivée avec un Hôte déjà présent ne montre pas de bandeau de retour.

L’Hôte confirme « Terminer le Live ». Une erreur permet de réessayer ; un acquittement seul ne ferme pas l’écran. À la fin reçue du serveur, la feuille récapitulative présente Achats, Réactions et Audience maximale. Le bouton Fermer appelle `onClose`. Un Spectateur voit le motif de fin et ferme l’écran sans récapitulatif. Quitter l’écran libère la session.

## Vérification manuelle (iOS 17+)

La spécification #19 prévoit une vérification manuelle des écrans, sans tests UI automatisés en v1. Avec le serveur local et deux Participants :

1. Ouvrir un Live, toucher l’Audience et connecter/déconnecter des Spectateurs de plusieurs apps. Vérifier total, classement, mise à jour de la feuille et état vide.
2. Couper la connexion de l’Hôte puis le reconnecter avant 60 secondes. Vérifier les deux bandeaux ; ouvrir ensuite le Live depuis un nouveau Spectateur et vérifier l’absence de faux « Hôte revenu ».
3. Couper la connexion du Spectateur : seul le message de reconnexion doit s’afficher. Revenir au Live, puis fermer l’écran et vérifier que ses connexions sont libérées.
4. Depuis l’Hôte, annuler puis confirmer la fin. Vérifier le récapitulatif et sa fermeture ; le Spectateur doit voir la fin sans récapitulatif. Répéter avec la feuille Audience ouverte à la réception de la fin.
5. Refaire avec l’Hôte absent plus de 60 secondes : vérifier le motif de fin chez le Spectateur. Vérifier aussi le remplacement de connexion et le Bannissement.
6. Appeler deux fois `startLive` depuis le même Hôte : vérifier le même identifiant et le titre initial. Vérifier les commandes refusées et la possibilité de réessayer.

Validation automatisée : `swift test`, puis `xcodebuild -scheme LiveSDK-Package -destination 'generic/platform=iOS Simulator' -quiet build`.
