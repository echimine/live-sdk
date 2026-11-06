# Tout l'état du Live passe par un WebSocket unique vers le serveur commun, pas par les canaux de données LiveKit

LiveKit ne transporte que l'audio et la vidéo. Tout le reste passe par un seul WebSocket entre le SDK et le serveur commun : chat, Réactions, Audience, Produit épinglé, Achats, Annonces d'achat, Demandes de montée, modération et cycle de vie du Live. LiveKit sait pourtant transporter des données (paquets, text streams, RPC). Mais le Shadowban, l'historique du chat et le total des Réactions exigent de toute façon que le serveur voie, filtre et conserve chaque message. Avec une seule source d'événements, le serveur commun reste la seule source de vérité sur l'état d'un Live, et la reconnexion comme le rattrapage n'ont qu'un canal à gérer.

## Considered Options

- **Canaux de données LiveKit pour le chat et les Réactions** : écarté. Pas de filtrage côté serveur (Shadowban), pas d'historique, et il faudrait synchroniser deux sources d'état.
- **Mixte (Réactions via LiveKit, le reste via WebSocket)** : écarté. Deux transports à reconnecter et un total des Réactions qui échappe au serveur.

## Consequences

- Le serveur commun ne consomme pas les webhooks LiveKit : la présence d'un Participant se déduit de son WebSocket.
- Une seule instance du serveur commun garde en mémoire l'état éphémère (présence, Audience, Demandes de montée). Passer à plusieurs instances demanderait d'ajouter un bus partagé (Redis, par exemple).
