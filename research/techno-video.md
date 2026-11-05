# Quelle techno vidéo temps réel auto-hébergeable sur le VPS ?

> Ticket : [#2](https://github.com/echimine/live-sdk/issues/2) · Carte : [#1](https://github.com/echimine/live-sdk/issues/1) · Recherche du 2026-11-05
> Vocabulaire : voir `GLOSSARY.md` (Live, Hôte, Co-hôte, Spectateur, Réaction…).

## Réponse courte

**LiveKit OSS** (serveur SFU Apache-2.0 + SDK officiels Swift et Kotlin). C'est le seul candidat qui coche à la fois la latence, les Co-hôtes multiples, des SDK natifs maintenus par l'éditeur sur les deux plateformes, une licence libre permissive, un déploiement en un seul binaire ou conteneur, et des canaux de données intégrés. mediasoup et Janus sont techniquement capables, mais n'ont **aucun SDK Swift ou Kotlin officiel** : il faudrait écrire nous-mêmes la couche client sur libwebrtc. WHIP/WHEP et LL-HLS ne couvrent que la vidéo (pas de données), et LL-HLS est au mieux à la limite des 2 s.

## Besoin rappelé

- Latence Hôte → Spectateur < 2 s.
- 1 Hôte + jusqu'à 4 Co-hôtes (soit 5 émetteurs au plus), venant d'App membres différentes.
- Quelques dizaines de Spectateurs (démo en classe).
- SDK natifs maintenus Swift (iOS) et Kotlin (Android).
- Licence libre, sans budget, auto-hébergé sur le VPS OVH.
- Si possible : canaux de données pour le chat et les Réactions.

VPS actuel (API OVH, `vps-9ca1f319.vps.ovh.net`) : offre **VPS-3 2027**, 6 vCores, 12 Go de RAM, 100 Go SSD, région GRA. La page commerciale OVH annonce une « bande passante illimitée, jusqu'à 3 Gbit/s » selon la gamme et 500 Mbit/s pour le VPS-1 ([ovhcloud.com/fr/vps](https://www.ovhcloud.com/fr/vps/)). Le débit exact du VPS-3 n'a pas pu être lu sur la page : **à vérifier dans le manager OVH**.

## Comparatif

| Critère | LiveKit OSS | mediasoup | Janus | WHIP/WHEP (ex. MediaMTX) | LL-HLS |
|---|---|---|---|---|---|
| Nature | Serveur SFU complet (Go), signalisation incluse | **Bibliothèque** SFU (Node.js ou Rust) : on écrit le serveur et la signalisation | Serveur WebRTC générique à plugins (C) | Protocoles HTTP d'ingest / lecture WebRTC ; MediaMTX est un serveur média | Diffusion HTTP par segments |
| Licence | Apache-2.0 | ISC | **GPL-3.0** (licence commerciale dispo) | WHIP = RFC 9725 ; MediaMTX MIT | Spec ouverte |
| Dernière version (2026-11) | serveur v1.13.11 (2026-10-25) | rust-0.33.2 (2026-11-04), actif | tag v1.4.3, commits actifs | MediaMTX v1.21.3 (2026-10-25) | — |
| SDK Swift (iOS) officiel | **Oui**, `client-sdk-swift` 2.19.0 (2026-10-27), SPM, iOS 13+ | Non (C++ `libmediasoupclient` seulement ; wrapper iOS communautaire `ethand91/mediasoup-ios-client`, dernier push 2025-06) | Non (SDK mobile Meetecho marqué **ABANDONED**) | Non : WebRTC brut (libwebrtc) à intégrer soi-même | Oui de fait : AVPlayer natif (lecture seule) |
| SDK Kotlin (Android) officiel | **Oui**, `client-sdk-android` v2.30.0 (2026-11-02), Gradle | Non (wrappers communautaires, ex. `haiyangwu/mediasoup-client-android` inactif depuis 2023) | Non (wrappers communautaires anciens) | Non : WebRTC brut | Oui de fait : ExoPlayer/Media3 (lecture seule) |
| Composants UI prêts | SwiftUI `components-swift` 0.1.7 ; Compose `components-android` v2.4.2 | Non | Non | Non | Lecteurs système |
| Latence | WebRTC, sous la seconde | WebRTC, sous la seconde | WebRTC, sous la seconde | WebRTC, sous la seconde | Plusieurs secondes (voir plus bas) |
| Co-hôtes multiples | Natif (room multi-publisher, promotion à chaud) | Possible, à coder | VideoRoom (`publishers`, défaut 3, configurable) | Un flux WHIP par Co-hôte, composition côté client à coder | Nécessite un mixeur côté serveur ou plusieurs flux |
| Canaux de données | **Oui** : paquets, text streams, RPC | Oui (DataProducer/DataConsumer SCTP), à câbler | Oui (data channels dans VideoRoom ; plugin TextRoom) | **Non** : WHIP ne couvre que le média unidirectionnel | Non |
| Effort côté projet | Faible : config + jetons | Élevé : serveur + signalisation + 2 SDK natifs | Élevé : 2 SDK natifs + GPL | Moyen/élevé : 2 clients WebRTC natifs + canal de données séparé | Faible pour regarder, mais latence hors cible et diffusion depuis le téléphone à résoudre (RTMP/WHIP) |

### LiveKit OSS

- **Licence et forme** : « LiveKit server is licensed under Apache License v2.0 » ; « single binary, Docker or Kubernetes » ([github.com/livekit/livekit](https://github.com/livekit/livekit)).
- **SDK natifs** : Swift (iOS, macOS, tvOS, visionOS ; SPM `.upToNextMajor("2.19.0")`, plateforme minimale `.iOS(.v13)` dans `Package.swift`) ([client-sdk-swift](https://github.com/livekit/client-sdk-swift)) ; Android/Kotlin, `io.livekit:livekit-android`, avec un module CameraX et une app d'exemple Compose ([client-sdk-android](https://github.com/livekit/client-sdk-android)). Composants UI séparés : [components-swift](https://github.com/livekit/components-swift) (encore en 0.x) et [components-android](https://github.com/livekit/components-android). Les deux SDK ont publié une version la semaine précédant cette recherche (API GitHub releases).
- **Rôles et Co-hôtes** : un participant peut être `hidden`, `canPublish`, `canSubscribe`, `canPublishData`. `UpdateParticipant` (grant `roomAdmin`) change ses permissions à chaud ; la doc cite explicitement la promotion d'un membre de l'audience en intervenant en lui donnant `CanPublish`. Retirer `canPublish` dépublie automatiquement ses pistes. Les clients reçoivent un événement `ParticipantPermissionChanged` ([participants](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants.md)). Cela correspond directement à la **Demande de montée** et au retrait d'un Co-hôte.
- **Métadonnées** : chaque participant a une `metadata` (chaîne) et des `attributes` (clé-valeur), modifiables via la même API (même source). Utile pour transporter App d'origine, pseudo et avatar.
- **Jetons** : le jeton d'accès est un JWT signé avec la clé et le secret d'API, « so it must be created on a backend server » ([authentication](https://docs.livekit.io/home/get-started/authentication/)). Pour nous : le **serveur commun** émet le jeton LiveKit après avoir vérifié le jeton signé par le backend de l'App d'origine (le secret LiveKit ne sort pas du VPS).
- **Ressources** : « The scalability of LiveKit is bound by CPU and bandwidth » ; recommandation d'instances orientées calcul ; Docker en `host networking` ; Redis « recommended for production » (nécessaire pour le multi-nœud) ([deployment](https://docs.livekit.io/home/self-hosting/deployment/)). Benchmark officiel livestream : 1 émetteur 720p, 3 000 abonnés, sur 16 cœurs à 92 % CPU et 531 Mo/s sortants ([benchmark](https://docs.livekit.io/home/self-hosting/benchmark/)). Notre charge est inférieure de plus d'un ordre de grandeur (voir estimation plus bas).
- **Déploiement VM** : `livekit/generate` produit `livekit.yaml`, `docker-compose.yaml`, `caddy.yaml` (TLS automatique), `redis.conf` et un script d'init. Il faut **deux noms de domaine** (principal et TURN) pointant vers le VPS ([vm](https://docs.livekit.io/home/self-hosting/vm/)). Le certificat doit être signé par une autorité reconnue : « self-signed certs do not work here » ([deployment](https://docs.livekit.io/home/self-hosting/deployment/)).

### mediasoup

- Module Node.js (ou crate Rust) côté serveur, SFU en C++ ; « does not mandate any signaling protocol » ([overview](https://mediasoup.org/documentation/overview/)). Licence ISC ([github.com/versatica/mediasoup](https://github.com/versatica/mediasoup)).
- Clients officiels : `mediasoup-client` (TypeScript, navigateur et Node, guide React Native) et `libmediasoupclient` (C++ sur libwebrtc) ([v3](https://mediasoup.org/documentation/v3/)). **Pas de SDK Swift ni Kotlin officiel** : il faudrait encapsuler la lib C++ sur iOS et Android, ou s'appuyer sur des wrappers communautaires peu maintenus (voir tableau).
- Données : DataProducer/DataConsumer via SCTP (« AKA DataChannel in WebRTC »), à activer avec `enableSctp`. `WebRtcServer` permet d'écouter sur un seul port UDP/TCP par worker ([API](https://mediasoup.org/documentation/v3/mediasoup/api/)).
- Verdict : excellent moteur, mais on écrirait signalisation, gestion de salle, rôles **et** deux SDK mobiles. Trop de surface pour un projet d'école.

### Janus

- « A general purpose WebRTC server », sous **GPLv3**, licence commerciale disponible ([docs](https://janus.conf.meetecho.com/docs/)).
- VideoRoom : flux de type `audio|video|data`, nombre d'émetteurs simultanés réglé par `publishers` (défaut 3) ([videoroom](https://janus.conf.meetecho.com/docs/videoroom.html)). TextRoom : « a plugin implementing a DataChannel only text room » ([textroom](https://janus.conf.meetecho.com/docs/textroom.html)).
- Mobile : le seul SDK Meetecho Android/iOS est marqué « Janus Client SDK [ABANDONED PROJECT] » ; le reste est communautaire (React Native, Cordova, un wrapper Android) ([resources](https://janus.conf.meetecho.com/docs/resources.html)).
- Verdict : comme mediasoup, pas de SDK natif maintenu, et la GPL ajoute une contrainte de redistribution si on modifie le serveur.

### WHIP/WHEP (ex. MediaMTX)

- WHIP est la RFC 9725 (Standards Track, mars 2025). Elle ne couvre que l'ingest : « WHIP only supports the ingestion use case with unidirectional media », sans renégociation SDP ([RFC 9725](https://www.rfc-editor.org/rfc/rfc9725.html)). **Pas de canal de données standardisé** : chat et Réactions passeraient par un WebSocket séparé.
- MediaMTX (MIT, v1.21.3) accepte la publication et la lecture en WebRTC, RTMP, SRT, HLS… ; lecture WebRTC sur `8889/TCP` et `8189/UDP` ([intro](https://mediamtx.org/docs/kickoff/introduction), [read](https://mediamtx.org/docs/usage/read)).
- Côté mobile, aucun SDK WHIP/WHEP officiel Swift/Kotlin n'est fourni par ces projets : il faut intégrer libwebrtc et coder l'échange SDP HTTP soi-même. Les Co-hôtes = N flux indépendants à afficher côté client, sans gestion de salle ni de rôles.
- LiveKit Ingress accepte aussi le WHIP (`7885/UDP`) ([vm](https://docs.livekit.io/home/self-hosting/vm/)), ce qui garde la porte ouverte à une diffusion depuis OBS plus tard.

### HLS basse latence (LL-HLS)

- La spec (draft rfc8216bis) définit le mode basse latence (segments partiels, rechargement bloquant de playlist, preload hints) mais **ne donne aucun chiffre de latence**. Elle impose `PART-HOLD-BACK` d'au moins 2 fois, et de préférence 3 fois, la durée cible d'un segment partiel. En HLS classique, `HOLD-BACK` vaut au moins 3 fois la durée cible d'un segment ([draft-pantos-hls-rfc8216bis](https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis)).
- **Estimation, non sourcée** : avec des parties de 0,2 à 0,5 s, plus l'encodage et le réseau, on obtient en pratique environ 2 à 5 s. C'est **au-dessus ou à la limite** de notre cible de 2 s. Le seul intérêt serait le passage à l'échelle, dont on n'a pas besoin (quelques dizaines de Spectateurs). Il faudrait en plus un chemin d'ingest (RTMP/WHIP) et un mixage pour les Co-hôtes.

## Canaux de données : chat et Réactions ?

LiveKit propose trois mécanismes, tous disponibles en Swift et en Android :

- **Paquets de données** : mode *reliable* (ordonné, retransmis, ≤ 15 Kio) ou *lossy* (≤ 1300 octets recommandés), avec un `topic` et des `destinationIdentities` optionnelles. Ils ne sont **pas stockés** par le serveur : un participant déconnecté au moment de l'envoi ne les reçoit pas ([packets](https://docs.livekit.io/home/client/data/packets/)).
- **Text streams** : texte fiable, découpé automatiquement, routé par topic, avec exemples Swift et Android ([text streams](https://docs.livekit.io/home/client/data/text-streams/)).
- **RPC** : appels requête/réponse entre participants (mentionnés dans la même doc).

Ce que ça implique pour nous :

- **Réactions** : les paquets *lossy* ou *reliable* sur un topic `reaction` conviennent bien pour l'animation en direct. En revanche, le **total conservé** et le **jeu fixe d'emojis** imposent que le serveur commun voie passer les Réactions (via un participant serveur, ou via un appel API qui rediffuse).
- **Chat** : techniquement faisable en text streams, mais le périmètre exige **historique conservé, Shadowban, suppression de message, Bannissement et Annonce d'achat**. Tout cela demande une autorité serveur qui filtre avant de diffuser. Un Shadowban est impossible si le client diffuse directement à la room. Recommandation : `canPublishData: false` pour les Spectateurs ; chat et Réactions **envoyés au serveur commun** (HTTP ou WebSocket), qui valide, stocke et rediffuse, soit par son propre WebSocket, soit en publiant dans la room LiveKit via l'API serveur. Ce choix relève du ticket de décision sur le protocole d'interaction, pas de celui-ci.
- **Audience** : les événements et webhooks de participants de LiveKit fournissent les entrées et sorties ; l'App d'origine peut voyager dans les `attributes` du participant.

## Ports UDP / TURN sur le VPS

D'après la [table des ports LiveKit](https://docs.livekit.io/home/self-hosting/ports-firewall/) et le [guide VM](https://docs.livekit.io/home/self-hosting/vm/) :

| Port | Proto | Rôle | À ouvrir ? |
|---|---|---|---|
| 443 | TCP | HTTPS / WebSocket de signalisation (derrière TLS) **et** TURN/TLS | Oui |
| 80 | TCP | Émission des certificats | Oui |
| 7881 | TCP | ICE/TCP, repli si l'UDP est bloqué | Oui |
| 3478 | UDP | TURN/UDP embarqué (sert aussi de STUN) | Oui (optionnel) |
| 50000–60000 | UDP | ICE/UDP, 2 ports par participant | Oui, **ou** à la place : |
| 7882 | UDP | ICE/UDP mux, tout l'UDP sur un seul port (`rtc.udp_port`) | Option pour éviter la plage |
| 7880 | TCP | API/WebSocket brute, derrière le proxy TLS | Non (interne) |

Points d'attention :

- **TURN est embarqué** dans LiveKit (`turn.enabled`, désactivé par défaut dans `config-sample.yaml`), donc pas de coturn séparé. TURN/TLS sur 443 est ce qui laisse passer les réseaux d'école ou d'entreprise qui bloquent l'UDP. **À activer pour la démo en classe.**
- Mettre `rtc.use_external_ip: true` (valeur du fichier d'exemple) pour que LiveKit annonce l'IP publique du VPS.
- **Conflit probable avec l'existant** : le VPS sert déjà d'autres apps derrière un reverse proxy (pattern GHCR → webhook). Le Caddy généré par `livekit/generate` veut le 443 et le TURN/TLS aussi. Il faudra soit router le domaine LiveKit dans le proxy existant (WebSocket vers 7880), soit faire du multiplexage SNI pour le domaine TURN. Deux sous-domaines sont nécessaires (ex. `live.` et `turn.`). Ce point est à trancher lors du ticket de déploiement.
- Docker en `network_mode: host`, recommandé pour la performance.

## Estimation de charge (calcul, non mesuré)

- 5 émetteurs au plus (Hôte + 4 Co-hôtes), 50 Spectateurs : environ 55 × 5 = **≈ 275 abonnements vidéo**.
- Avec la simulcast et l'adaptive stream du SDK, des tuiles de grille reçoivent des couches basses (de l'ordre de quelques centaines de kbit/s). Hypothèse prudente : 0,5 à 1,5 Mbit/s par abonnement, soit **≈ 140 à 410 Mbit/s sortants** au pire, nettement moins si seul l'Hôte est en grand.
- CPU : le benchmark officiel tient 3 000 abonnés sur 16 cœurs ; ~275 abonnements sur 6 vCores devraient laisser une marge confortable. **Le facteur limitant sera la bande passante du VPS**, à confirmer (voir plus haut). Si besoin, il suffit de plafonner la résolution ou le débit des Co-hôtes.

## Recommandation

**Adopter LiveKit OSS** (serveur v1.13.x, mono-nœud Docker sur le VPS, TURN embarqué activé), avec `client-sdk-swift` et `client-sdk-android` comme couche média des deux SDK Live.

Pourquoi :
1. C'est le seul candidat avec des **SDK natifs Swift et Kotlin officiels et activement publiés**. Les autres nous obligent à écrire deux clients WebRTC, ce qui sort du budget temps.
2. Le modèle room / participant / permissions correspond **directement** au domaine : Hôte et Co-hôtes = `canPublish`, Spectateurs = `canSubscribe` seul, Demande de montée = `UpdateParticipant`, métadonnées = App d'origine, pseudo, avatar.
3. Latence WebRTC sous la seconde, bien en dessous de 2 s.
4. Apache-2.0, un seul binaire, et des ressources largement suffisantes pour quelques dizaines de Spectateurs.

Compromis acceptés :
- Dépendance à l'écosystème LiveKit (API et protocole propres, pas du WebRTC « nu »). Mitigation : nos SDK encapsulent LiveKit derrière notre propre cœur, sans exposer ses types aux App membres.
- Il faut 2 sous-domaines, TLS valide, et une plage UDP (ou le port mux) ouverte. Il faut aussi cohabiter avec le reverse proxy existant sur 443.
- `components-swift` est encore en 0.x : nos écrans SwiftUI devront sans doute être écrits nous-mêmes sur le SDK cœur.
- Les canaux de données LiveKit ne suffisent pas pour un chat **modéré** et persistant : chat, Réactions et Achats doivent transiter par le serveur commun.

Plan B : si LiveKit posait problème, **mediasoup** (ISC) est le repli le plus solide techniquement, au prix d'écrire la signalisation et deux clients natifs. LL-HLS est à écarter pour la v1 (latence hors cible, pas de données).

## Questions ouvertes pour la suite de la carte

- Débit public réel du VPS-3 et éventuel plafond de trafic : à lire dans le manager OVH.
- Intégration de LiveKit derrière le reverse proxy existant (443 partagé, TURN/TLS, sous-domaines).
- Canal chat / Réactions : WebSocket du serveur commun, ou rediffusion dans la room LiveKit par l'API serveur ?
