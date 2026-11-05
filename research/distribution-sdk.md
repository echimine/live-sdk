# Distribution des SDK Swift et Kotlin avec mises à jour quasi automatiques

Ticket : [#6](https://github.com/echimine/live-sdk/issues/6) — carte [#1](https://github.com/echimine/live-sdk/issues/1).
Recherche du 2026-11-05, faite à partir de sources primaires (docs officielles, code source, changelogs éditeurs).

## Contexte

- Repo public `echimine/live-sdk` : serveur + SDK Swift (SwiftUI) + SDK Kotlin (Jetpack Compose).
- Consommateurs : 4 apps iOS (dont clone-strava, générée avec XcodeGen) et 1 app Android Gradle (Kotlin DSL).
- Objectif : installation en une ligne, mises à jour quasi automatiques, zéro budget.

## Recommandation (résumé)

1. **Un seul tag semver `X.Y.Z` (sans préfixe) par release, partagé par les deux SDK**, créé via une GitHub Release.
2. **Swift** : `Package.swift` **à la racine du repo**, dont les targets pointent vers le sous-dossier du SDK avec `path:` (ex. `sdk/swift/Sources/LiveSDK`). Les apps déclarent `from: "1.0.0"` (jusqu'à la prochaine majeure).
3. **Kotlin** : **JitPack** (gratuit pour l'open source, aucun jeton côté consommateur, sait builder un `build.gradle` dans un sous-dossier, publie à partir du tag/de la Release). Pas de GitHub Packages (jeton obligatoire même en public) ni de Maven Central (trop lourd pour un projet d'école).
4. **Mises à jour** : Dependabot dans chaque app (`swift` + `gradle`). Pour clone-strava (XcodeGen, `.xcodeproj` probablement non versionné), une règle Renovate `customManagers` regex sur `project.yml`, ou à défaut une mise à jour manuelle — la plage `from:` suffit de toute façon à récupérer les mineures via « Update to Latest Package Versions ».
5. **CI** : un workflow `on: release: types: [published]` qui teste les deux SDK et « préchauffe » JitPack en appelant l'URL de l'artefact. Aucun secret nécessaire.

Le détail et les sources suivent.

---

## 1. Swift Package Manager dans un monorepo

### Le manifeste doit être à la racine du dépôt Git

- La doc SwiftPM définit un package ainsi : « A Swift package is a directory that contains sources, dependencies, and has a `Package.swift` manifest file at its root. » — [CreatingSwiftPackage.md](https://github.com/swiftlang/swift-package-manager/blob/main/Sources/PackageManagerDocs/Documentation.docc/CreatingSwiftPackage.md)
- Une dépendance distante se déclare par une URL Git et une exigence de version (`.package(url:from:)`) — [AddingDependencies.md](https://github.com/swiftlang/swift-package-manager/blob/main/Sources/PackageManagerDocs/Documentation.docc/Dependencies/AddingDependencies.md). L'API `.package(url:…)` n'a **aucun paramètre de sous-chemin** : SwiftPM clone le dépôt et lit le manifeste à sa racine. Un package placé dans `sdk/swift/Package.swift` ne serait donc pas consommable par URL.
- **Contournement standard** : mettre `Package.swift` à la racine et pointer chaque target vers le sous-dossier avec le paramètre `path:` de `.target(name:dependencies:path:…)` — [PackageDescription / Target](https://developer.apple.com/documentation/packagedescription/target). Le code reste rangé dans `sdk/swift/`, seul le manifeste remonte.

Esquisse :

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "LiveSDK",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "LiveSDK", targets: ["LiveSDK"]),       // cœur sans UI
        .library(name: "LiveSDKUI", targets: ["LiveSDKUI"]),   // écrans SwiftUI
    ],
    targets: [
        .target(name: "LiveSDK", path: "sdk/swift/Sources/LiveSDK"),
        .target(name: "LiveSDKUI", dependencies: ["LiveSDK"], path: "sdk/swift/Sources/LiveSDKUI"),
        .testTarget(name: "LiveSDKTests", dependencies: ["LiveSDK"], path: "sdk/swift/Tests/LiveSDKTests"),
    ]
)
```

Deux produits = les « 2 couches » décidées dans la carte (cœur + écrans prêts à l'emploi).

Inconvénient connu : chaque app clone le monorepo entier (serveur compris). Acceptable vu la taille du projet ; à surveiller si on versionne de gros fichiers (vidéos de test, etc.).

### Tags semver

- « The package manager uses git tags, interpreted as a semantic version, to identify eligible versions of packages. » — [AddingDependencies.md](https://github.com/swiftlang/swift-package-manager/blob/main/Sources/PackageManagerDocs/Documentation.docc/Dependencies/AddingDependencies.md)
- « tags for package versions should include all three components of a semantic version: major, minor, and patch. Tags that only include one or two of those components are not interpreted as semantic versions. » — même source. Donc `1.2.0`, pas `1.2`.
- `from: "4.0.0"` = « at least version 4.0.0, and allow any other version up to the next major version » — même source. C'est ce qui donne les mises à jour « quasi automatiques » : toute mineure/patch est éligible sans toucher au projet de l'app.
- Les versions choisies sont figées dans `Package.resolved` ; `swift package update` (ou dans Xcode *File > Packages > Update to Latest Package Versions*) passe aux dernières versions éligibles et réécrit ce fichier — [ResolvingPackageVersions.md](https://github.com/swiftlang/swift-package-manager/blob/main/Sources/PackageManagerDocs/Documentation.docc/ResolvingPackageVersions.md).
- Conséquence monorepo : un tag Git marque **tout** le dépôt. Un tag `swift-1.2.0` ne serait pas lu comme semver par SwiftPM. Le plus simple est donc **une version commune aux deux SDK** (`1.2.0` pour Swift et Kotlin), ce qui colle bien à un protocole serveur partagé.

## 2. Ajouter le package avec XcodeGen (clone-strava)

D'après la [spec XcodeGen (ProjectSpec.md)](https://github.com/yonaskolb/XcodeGen/blob/master/Docs/ProjectSpec.md) : section `packages` au niveau projet (`url` ou raccourci `github`, et une exigence parmi `from`/`majorVersion`, `minorVersion`, `exactVersion`, `minVersion`+`maxVersion`, `branch`, `revision`), puis dépendance de target `package:` + `product:`/`products:`.

```yaml
packages:
  LiveSDK:
    url: https://github.com/echimine/live-sdk
    from: 1.0.0

targets:
  CloneStrava:
    dependencies:
      - package: LiveSDK
        products:
          - LiveSDK
          - LiveSDKUI
```

Pour développer le SDK en local, XcodeGen accepte aussi un package local (`path: ../live-sdk`, « directory with a `Package.swift` ») — ce qui suppose là encore le manifeste à la racine du repo.

## 3. Gradle : JitPack vs GitHub Packages vs Maven Central

| Critère | JitPack | GitHub Packages | Maven Central |
|---|---|---|---|
| Jeton côté app consommatrice | Non | **Oui, même pour un package public** | Non |
| Coût | « always free for open-source » | Gratuit pour le public | Gratuit |
| Effort de publication | Créer une GitHub Release (build à la demande) | Workflow `./gradlew publish` avec `GITHUB_TOKEN` | Namespace vérifié, signature GPG, jars sources + javadoc, POM complet, plugin tiers |
| Sous-dossier dans un monorepo | Oui (`build.gradle` dans un sous-dossier, `jitpack.yml` à la racine) | Oui (on build ce qu'on veut en CI) | Oui (idem) |
| Fiabilité | Build au premier appel (lent, peut échouer) | Bonne | Excellente |

### JitPack

- « JitPack builds Git projects on demand and provides you with ready-to-use artifacts (jar, aar). » La première requête déclenche le build, d'où une latence ; on publie en créant une GitHub Release ; le tag devient la version — [docs.jitpack.io](https://docs.jitpack.io/).
- « The `build.gradle` file can also be located in a subfolder. » ; `jitpack.yml` à la racine permet de surcharger `jdk`, `before_install`, `install` ; JDK 8 par défaut, il faut donc déclarer JDK 17/21 — [docs.jitpack.io/building](https://docs.jitpack.io/building/).
- Multi-modules : « If the project builds multiple modules JitPack publishes all of them », coordonnées `com.github.User.Repo:Module:Tag` — même page. Exemple ici : `com.github.echimine.live-sdk:live-sdk-core:1.2.0` et `…:live-sdk-ui:1.2.0`.
- « JitPack is always **free** for open-source. » — [jitpack.io/private](https://jitpack.io/private).

Côté app Android (`settings.gradle.kts`) :

```kotlin
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://jitpack.io") // à mettre en dernier, comme le recommande JitPack
    }
}
```

`jitpack.yml` (racine du monorepo), à valider au moment de l'implémentation :

```yaml
jdk:
  - openjdk17
install:
  - cd sdk/android && ./gradlew publishToMavenLocal
```

Point d'attention : la doc dit que l'étape `install` doit produire les artefacts dans le projet **et** les copier dans `~/.m2/repository` ; `publishToMavenLocal` fait précisément cette copie. À tester dès le premier tag.

### GitHub Packages

- « You need an access token to publish, install, and delete private, internal, and public packages. » — [Working with the Gradle registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-gradle-registry). Chaque développeur de l'app Android (et sa CI) devrait donc créer un PAT `read:packages`. Rédhibitoire pour « installation facile ».

### Maven Central

- Exigences : jars `-sources` et `-javadoc`, signature GPG de chaque fichier (`.asc`), POM avec name/description/url/licence/développeurs/SCM — [Requirements](https://central.sonatype.org/publish/requirements/) ; enregistrement et vérification d'un namespace (pages liées depuis la même doc).
- « Currently, there is no official Gradle plugin for publishing to Maven Central via the Central Publishing Portal. » Il faut un plugin communautaire (JReleaser, `vanniktech/gradle-maven-publish-plugin`…) — [Publish Portal / Gradle](https://central.sonatype.org/publish/publish-portal-gradle/).
- Bien pour une bibliothèque durable, disproportionné pour une démo en classe. Option de repli si JitPack pose problème.

## 4. Mises à jour automatiques chez les apps : Dependabot et Renovate

### Dependabot

- Écosystème `swift` supporté (v5, v6) en version updates et security updates ; registres privés « git only » ; « Non-declarative manifests are not supported. » Écosystème `gradle` supporté, y compris `build.gradle.kts` et `gradle/libs.versions.toml` — [Supported ecosystems](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories).
- **Nouveau (2026-03-31)** : Dependabot sait mettre à jour les apps Xcode **sans `Package.swift`** : il découvre les `Package.resolved` dans `.xcodeproj`/`.xcworkspace`, lit les règles de version dans `project.pbxproj` et ouvre des PR qui mettent à jour `Package.resolved` — [changelog GitHub](https://github.blog/changelog/2026-03-31-dependabot-now-supports-xcode-projects-using-swiftpm-with-xcodeproj-manifests). Condition : `.xcodeproj` **et** `Package.resolved` versionnés dans Git.
- Gradle + JitPack : un registre déclaré seulement dans `build.gradle` n'est pas autorisé par le pare-feu de Dependabot ; « Declare a registry under the top-level `registries` key even if it allows anonymous access » — [Configuring access to private registries](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/configuring-access-to-private-registries-for-dependabot).

`.github/dependabot.yml` type pour l'app Android :

```yaml
version: 2
registries:
  jitpack:
    type: maven-repository
    url: https://jitpack.io
updates:
  - package-ecosystem: gradle
    directory: "/"
    registries: "*"
    schedule:
      interval: daily
    allow:
      - dependency-name: "com.github.echimine.live-sdk*"
```

Et pour une app iOS avec `.xcodeproj` versionné :

```yaml
version: 2
updates:
  - package-ecosystem: swift
    directory: "/"
    schedule:
      interval: daily
```

### Renovate

- Manager `swift` : ne lit que `Package.swift` (regex `/(^|/)Package\.swift/`), datasources `git-tags`/`github-tags`/`gitlab-tags` — [Renovate swift manager](https://docs.renovatebot.com/modules/manager/swift/). Inutile pour une app Xcode sans `Package.swift`.
- Manager `gradle` : `build.gradle(.kts)`, `gradle/*.toml` (version catalogs)… datasource `maven` — [Renovate gradle manager](https://docs.renovatebot.com/modules/manager/gradle/).
- **Cas XcodeGen** : un `customManagers` regex peut mettre à jour n'importe quel fichier, avec la datasource `github-tags` — [Renovate regex manager](https://docs.renovatebot.com/modules/manager/regex/). C'est la seule voie automatique si clone-strava ne versionne pas son `.xcodeproj` :

```json
{
  "customManagers": [
    {
      "customType": "regex",
      "managerFilePatterns": ["/(^|/)project\\.ya?ml$/"],
      "matchStrings": ["url: https://github\\.com/echimine/live-sdk\\s+from:\\s*(?<currentValue>\\d+\\.\\d+\\.\\d+)"],
      "depNameTemplate": "echimine/live-sdk",
      "datasourceTemplate": "github-tags"
    }
  ]
}
```

### En pratique

- Avec `from: "1.0.0"` (Swift) l'app accepte déjà toute version `1.x` ; ce qui « fige » la version, c'est `Package.resolved`. Le bot ouvre une PR qui avance ce fichier : il suffit de la merger.
- Côté Gradle, Gradle ne fait pas de plage par défaut : on fixe `1.2.0` et Dependabot ouvre une PR à chaque nouveau tag (les versions dynamiques `1.+` fonctionnent avec JitPack mais rendent les builds non reproductibles ; à éviter).
- Les mises à jour vraiment instantanées (jeu de réactions, config) passent par la **config pilotée par le serveur**, déjà décidée dans la carte ; les bots ne couvrent que le code du SDK.

## 5. Publication automatique via GitHub Actions

- GitHub documente le déclencheur `on: release: types: [created]` avec `./gradlew publish` et `GITHUB_TOKEN` (GitHub Packages) ou les identifiants OSSRH (Maven Central, en précisant que ces exemples visent l'ancien service OSSRH) — [Publishing Java packages with Gradle](https://docs.github.com/en/actions/tutorials/publish-packages/publish-java-packages-with-gradle).
- Avec la recommandation retenue, **il n'y a rien à « pousser »** : SwiftPM lit le tag Git, JitPack builde depuis la Release. Le workflow sert à vérifier et à préchauffer :

```yaml
name: Release SDK
on:
  release:
    types: [published]
jobs:
  swift:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - run: swift build && swift test   # ou xcodebuild pour la cible iOS
  android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 17 }
      - run: cd sdk/android && ./gradlew build
  warm-jitpack:
    needs: android
    runs-on: ubuntu-latest
    steps:
      # Déclenche le build JitPack pour que la 1re app ne subisse pas la latence
      - run: |
          curl -sf --retry 10 --retry-delay 30 --max-time 900 \
            "https://jitpack.io/com/github/echimine/live-sdk/${GITHUB_REF_NAME}/build.log" || true
```

- Pour automatiser aussi la création du tag/de la Release (numéro semver calculé à partir des commits), un outil comme release-please peut ouvrir une PR de release ; optionnel pour ce projet.
- Garde-fou : un job sur les PR qui lance `swift build` et `./gradlew build` sur `main` évite de tagger une version cassée, puisqu'un tag publié devient immédiatement éligible pour toutes les apps en `from:`.

## Questions ouvertes (pour l'implémentation)

- Structure exacte des dossiers (`sdk/swift`, `sdk/android`, `server/`) et noms des modules Gradle (`live-sdk-core`, `live-sdk-ui`) : à fixer avec le ticket sur la structure des SDK.
- Vérifier que clone-strava et les autres apps iOS versionnent ou non leur `.xcodeproj`/`Package.resolved` (détermine Dependabot vs Renovate regex).
- Tester `jitpack.yml` sur un premier tag `0.1.0` avant la démo.
