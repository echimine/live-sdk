# App d'exemple iOS

Mini-app déclarée comme App membre de test **`demo-ios`** (`server/member-apps.example.json`),
pour essayer les écrans de bout en bout contre le `docker compose` local.

> Pour rester sans backend, elle signe elle-même ses Jetons de Participant avec le secret
> **de test** de `demo-ios`. Une vraie App membre ne fait jamais ça : son backend signe le jeton
> (`examples/participant-token`), et le secret ne quitte pas le serveur.

## Lancer l'environnement

À la racine du dépôt :

```sh
LIVEKIT_NODE_IP=127.0.0.1 docker compose up -d   # simulateur ; IP locale de la machine pour un vrai iPhone
cp server/member-apps.example.json server/member-apps.local.json
DATABASE_URL=postgres://live:live@localhost:5432/live \
MEMBER_APPS_FILE=member-apps.local.json \
LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
  pnpm --filter @live-sdk/server dev
```

`LIVEKIT_URL` est l'adresse du LiveKit **vue depuis le téléphone** : `localhost` pour le simulateur,
l'IP locale de la machine (ex. `ws://192.168.1.20:7880`) pour un vrai iPhone sur le même Wi-Fi.
`LIVEKIT_NODE_IP` est l'IP que LiveKit annonce pour le média : sous Docker Desktop (macOS), sans elle,
LiveKit annonce l'IP interne du conteneur et la room ne se connecte jamais (« participant closing »
au bout de 10 s dans `docker compose logs livekit`).

## Ouvrir l'app

```sh
open swift/Sample/LiveSample.xcodeproj
```

Le projet est généré par [XcodeGen](https://github.com/yonaskolb/XcodeGen) depuis `project.yml`
(`xcodegen generate` dans `swift/Sample/` après l'avoir modifié). Réglages dans `project.yml` :
`LIVE_SERVER_URL` (`http://localhost:3000` par défaut ; l'IP de la machine pour un vrai iPhone),
`LIVE_APP_ID`, `LIVE_TOKEN_SECRET`. Pour un vrai iPhone, choisissez votre équipe dans
*Signing & Capabilities*.

## Vérification manuelle

Le simulateur n'a pas de caméra : l'Hôte doit être un vrai iPhone (ou l'app d'exemple Android).

1. iPhone A : pseudo « Hôte », **Lancer un Live**, « Autoriser la caméra et le micro », attendre les 3 ✓, **Lancer**.
2. Téléphone B (ou simulateur) : pseudo « Spectateur », le Live apparaît dans la liste (titre, Hôte, `demo-ios`, Audience) ; le toucher.
3. B voit la vidéo de A en plein écran, sous la seconde ; ✕ ramène à la liste.
4. Sur B, coller l'identifiant du Live (ou un lien `…/lives/<id>`) dans le champ de lien direct ouvre le même Live.
