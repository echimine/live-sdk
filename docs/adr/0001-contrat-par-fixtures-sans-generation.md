# Contrat du protocole : types écrits à la main et fixtures partagées, sans génération de code

Le serveur (TypeScript), le SDK Swift et le SDK Kotlin doivent échanger exactement les mêmes messages du Live. Plutôt que de générer les types depuis un schéma unique, chaque langage écrit ses propres types, et `protocol/fixtures/` contient un jeu d'exemples JSON de référence. La CI de chaque langage vérifie que chaque fixture se décode puis se réencode à l'identique, et le serveur valide les messages entrants avec Zod. Avec une vingtaine de types de messages, la saisie manuelle reste raisonnable, et elle donne des `enum` Swift 6 `Sendable` et des `sealed class` Kotlin idiomatiques, alors que les générateurs gèrent mal les unions discriminées.

## Considered Options

- **JSON Schema comme source, avec génération pour les 3 langages** : écarté, le code mobile généré est peu idiomatique pour les unions discriminées.
- **Zod comme source, avec export JSON Schema puis génération** : écarté pour la même raison côté Swift et Kotlin.

## Consequences

- Tout changement de protocole commence par une fixture dans `protocol/fixtures/`. Une PR qui modifie `protocol/` déclenche les tests des trois langages.
