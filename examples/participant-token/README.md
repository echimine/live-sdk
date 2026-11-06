# Exemple : `POST /live/participant-token`

Chaque App membre ajoute cet endpoint à son backend. Il signe un **Jeton de
Participant** pour l'utilisateur connecté et répond `{ "token": "…" }`. Le SDK
l'appelle via son `tokenProvider` à chaque connexion.

Le jeton est un JWT HS256 valable 5 min, signé avec le secret de votre App membre
(transmis en privé par echimine, jamais commité) :

| Claim     | Valeur                                                    |
| --------- | --------------------------------------------------------- |
| `iss`     | identifiant de votre App membre (`tiktok`, `strava`…)     |
| `sub`     | identifiant de l'utilisateur dans votre app               |
| `name`    | pseudo, 1 à 30 caractères visibles (sinon jeton refusé)   |
| `picture` | avatar en `https://`, facultatif (sinon ignoré)           |
| `exp`     | expiration                                                |

Aucun rôle : le serveur commun décide seul qui est Hôte, Co-hôte ou Spectateur.

```sh
npm install
LIVE_APP_ID=demo-ios LIVE_TOKEN_SECRET=… npm start
curl -X POST http://localhost:4000/live/participant-token
```

Remplacez `currentUser` par l'authentification de votre app.
Sans `LIVE_TOKEN_SECRET`, le serveur refuse de démarrer (secret de test : `demo-ios` de `server/member-apps.example.json`).
