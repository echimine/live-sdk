# Contrat du protocole

Fixtures JSON de référence entre le serveur commun et les SDK Swift et Kotlin (voir `docs/adr/0001-contrat-par-fixtures-sans-generation.md`). Chaque langage écrit ses propres types et vérifie que chaque fixture se décode puis se réencode à l'identique. « À l'identique » signifie la même valeur JSON : l'ordre des clés et la mise en forme ne comptent pas. Tout changement de protocole commence ici.

## Organisation

- `fixtures/config.json` : réponse de `GET /v1/config`, et valeurs par défaut embarquées dans les SDK.
- `fixtures/http/` : corps des messages HTTP `/v1/`, nommés `<ressource>.<action>.<request|response>.json` ; `error.<code>.json` est le corps d'une réponse en erreur, un fichier par code (`HttpErrorCode` dans `server/src/protocol/http.ts`).
- `fixtures/ws/client/` : messages du SDK vers le serveur sur `/v1/lives/{id}/ws`.
- `fixtures/ws/server/` : messages du serveur vers le SDK.

Un fichier WebSocket porte le nom de son `type` ; un suffixe distingue les variantes d'un même type (`snapshot.host.json`, `chatMessage.purchase.json`, `error.<code>.json`). Chaque `type` a au moins une fixture, et chaque code d'erreur aussi.

## Routes HTTP (`/v1/`)

Toutes exigent un Jeton de Participant (`Authorization: Bearer`), à une exception près : `GET /v1/images/:name` est servi sans jeton, car les URLs d'image sont partagées entre Participants (dans `productPinned`, les Annonces d'achat…) et chargées directement par les vues.

- `GET /v1/lives` → `lives.list.response.json` ; `POST /v1/lives` → `lives.create.request.json` / `lives.create.response.json`.
- `GET /v1/lives/{id}/summary` → `lives.summary.response.json` : le récapitulatif de fin d'un Live **terminé**, pour son Hôte seul (le même que le `summary` de `liveEnded`). `404 not_found` si le Live est inconnu, encore en cours, ou si l'appelant n'en est pas l'Hôte. C'est ainsi que l'Hôte retrouve son récapitulatif quand son Live s'est terminé par Délai de grâce pendant son absence.
- `POST /v1/images` → `images.upload.response.json` ; `GET /v1/config` → `config.json`.

## Conventions du fil

- Enveloppe JSON discriminée par `type`. Les commandes portent un `ref`, auquel le serveur répond par `ack` ou `error` (même `ref`). `join` et `react` n'ont pas de `ref`. Les événements n'en ont pas.
- Codes d'erreur fermés (`ErrorCode` dans `server/src/protocol/ws.ts`) ; `retryAfterMs` accompagne `rate_limited`. En plus des codes de la spec (`banned`, `not_animator`, `cohost_limit`, `rate_limited`, `product_changed`, `invalid_message`, `invalid_product`, `unknown_command`), le serveur en émet cinq autres :
  - `invalid_token` : `join` au Jeton de Participant refusé ;
  - `live_not_found` : Live inconnu ou terminé (au `join`, ou pour une commande arrivée après la fin) ;
  - `not_host` : commande réservée à l'Hôte (`endLive`, `acceptJoin`, `declineJoin`, `removeCohost`) ;
  - `invalid_command` : commande connue mais mal formée, impossible dans ce rôle (`requestToJoin` d'un Animateur, `leaveStage` d'un Spectateur), ou reçue avant la fin du `join` ;
  - `not_found` : message, Demande de montée, Co-hôte ou Participant introuvable dans ce Live.
- Un `error` **sans `ref`** répond à `join` (socket ensuite fermé en 1008) ou à une commande dont le `ref` est absent ou invalide (chaîne vide ou de plus de 64 caractères) : le SDK ne peut alors le rattacher à aucune commande. Une commande inconnue sans `ref` est ignorée en silence.
- Un champ optionnel absent est omis, jamais `null`.
- Les récepteurs ignorent les types et les champs inconnus.
- Prix en centimes (entiers), devise ISO 4217 ; aucun prix formaté sur le fil.
- Horodatages ISO 8601 en UTC.
- `Participant.id` est opaque et attribué par le serveur ; les commandes désignent un Participant par `participantId`.
