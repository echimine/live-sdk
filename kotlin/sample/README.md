# App d'exemple Android

Mini-app déclarée comme App membre de test **`demo-android`**
(`server/member-apps.example.json`), pour essayer les écrans de bout en bout contre le
`docker compose` local.

> Pour rester sans backend, elle signe elle-même ses Jetons de Participant avec le secret
> **de test** de `demo-android`. Une vraie App membre ne fait jamais ça : son backend signe
> le jeton (`examples/participant-token`), et le secret ne quitte pas le serveur.

## Lancer l'environnement

À la racine du dépôt :

```sh
docker compose up -d
cp server/member-apps.example.json server/member-apps.local.json
DATABASE_URL=postgres://live:live@localhost:5432/live \
MEMBER_APPS_FILE=member-apps.local.json \
LIVEKIT_URL=ws://10.0.2.2:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
  pnpm --filter @live-sdk/server dev
```

`LIVEKIT_URL` est l'adresse du LiveKit **vue depuis le téléphone** : `10.0.2.2` pour l'émulateur,
l'IP locale de la machine (ex. `ws://192.168.1.20:7880`) pour un vrai téléphone sur le même Wi-Fi.

## Installer l'app

Depuis `kotlin/` :

```sh
./gradlew :sample:installDebug                                          # émulateur
./gradlew :sample:installDebug -Plive.serverUrl=http://192.168.1.20:3000 # vrai téléphone
```

Propriétés disponibles : `live.serverUrl`, `live.appId`, `live.tokenSecret`.

## Vérification manuelle

1. Téléphone A : pseudo « Hôte », **Lancer un Live**, « Autoriser la caméra et le micro », attendre les 3 ✓, **Lancer**.
2. Téléphone B : pseudo « Spectateur », le Live apparaît dans la liste (titre, Hôte, `demo-android`, Audience) ; le toucher.
3. B voit la vidéo de A en plein écran, sous la seconde ; ✕ ramène à la liste.
4. Sur B, coller l'identifiant du Live (ou un lien `…/lives/<id>`) dans le champ de lien direct ouvre le même Live.
