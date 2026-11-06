# Contrat du protocole

Fixtures JSON de référence entre le serveur commun et les SDK Swift et Kotlin (voir `docs/adr/0001-contrat-par-fixtures-sans-generation.md`). Chaque langage écrit ses propres types et vérifie que chaque fixture se décode puis se réencode à l'identique. « À l'identique » signifie la même valeur JSON : l'ordre des clés et la mise en forme ne comptent pas. Tout changement de protocole commence ici.

## Organisation

- `fixtures/config.json` : réponse de `GET /v1/config`, et valeurs par défaut embarquées dans les SDK.
- `fixtures/http/` : corps des messages HTTP `/v1/`, nommés `<ressource>.<action>.<request|response>.json` ; `error.json` est le corps de toute réponse en erreur.
- `fixtures/ws/client/` : messages du SDK vers le serveur sur `/v1/lives/{id}/ws`.
- `fixtures/ws/server/` : messages du serveur vers le SDK.

Un fichier WebSocket porte le nom de son `type` ; un suffixe distingue les variantes d'un même type (`snapshot.host.json`, `chatMessage.purchase.json`). Chaque `type` a au moins une fixture.

## Conventions du fil

- Enveloppe JSON discriminée par `type`. Les commandes portent un `ref`, auquel le serveur répond par `ack` ou `error` (même `ref`). `join` et `react` n'ont pas de `ref`. Les événements n'en ont pas.
- Codes d'erreur fermés (`ErrorCode` dans `server/src/protocol/ws.ts`) ; `retryAfterMs` accompagne `rate_limited`.
- Un champ optionnel absent est omis, jamais `null`.
- Les récepteurs ignorent les types et les champs inconnus.
- Prix en centimes (entiers), devise ISO 4217 ; aucun prix formaté sur le fil.
- Horodatages ISO 8601 en UTC.
- `Participant.id` est opaque et attribué par le serveur ; les commandes désignent un Participant par `participantId`.
