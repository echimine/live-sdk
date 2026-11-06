# Live SDK

Outil commun qui permet aux apps clones (TikTok, Twitch, Instagram, Snapchat, Strava) de lancer des lives, de les regarder et d'y interagir d'une app à l'autre.

## Language

### Le live

**Live**:
Une diffusion vidéo et audio en temps réel, lancée depuis la caméra du téléphone d'un Hôte, et visible depuis n'importe quelle App membre.
_Avoid_: Stream, broadcast, session, direct

**App membre**:
Une des apps clones branchées sur l'outil commun ; chacune garde ses propres comptes.
_Avoid_: Client, tenant, plateforme

**App d'origine**:
L'App membre d'où vient un Participant, affichée à côté de son pseudo.
_Avoid_: Source, provenance

### Les personnes

**Participant**:
Toute personne présente dans un Live, identifiée par son App d'origine, son identifiant dans cette app, son pseudo et son avatar. Il n'existe pas de compte commun entre les apps.
_Avoid_: Utilisateur, membre, compte

**Jeton de Participant**:
La preuve, émise par le backend de son App d'origine, de l'identité d'un Participant (App d'origine, identifiant, pseudo, avatar) ; elle ne dit rien de son rôle dans un Live.
_Avoid_: Token d'auth, session, credential

**Hôte**:
Le Participant qui a lancé le Live ; le Live se termine quand il l'arrête.
_Avoid_: Streamer, owner, créateur

**Co-hôte**:
Un Participant qui apparaît à l'écran du Live aux côtés de l'Hôte, quelle que soit son App d'origine.
_Avoid_: Invité, guest, collaborateur

**Spectateur**:
Un Participant qui regarde le Live sans apparaître à l'écran.
_Avoid_: Viewer, follower

**Demande de montée**:
La demande d'un Spectateur pour devenir Co-hôte, que l'Hôte accepte ou refuse.
_Avoid_: Invitation, join request

**Animateur**:
L'Hôte ou un Co-hôte : ceux qui peuvent épingler un Produit et modérer le Live.
_Avoid_: Modérateur, admin, staff

**Délai de grâce**:
Le temps pendant lequel un Animateur déconnecté garde sa place dans le Live ; passé ce délai, un Co-hôte redevient Spectateur et le Live de l'Hôte se termine.
_Avoid_: Timeout, expiration

### Les interactions

**Réaction**:
Un emoji choisi dans un jeu fixe commun à toutes les App membres, envoyé par un Participant et affiché en animation chez tous ; seul leur total est conservé.
_Avoid_: Like, emote

**Audience**:
Le nombre de Spectateurs connectés à un instant donné, Animateurs exclus, détaillé par App d'origine.
_Avoid_: Viewers, vues, compteur de vues

### Le commerce

**Produit épinglé**:
Le seul produit mis en avant dans un Live à un instant donné, avec un nom, un prix et une image ; un Animateur peut le changer pendant le Live.
_Avoid_: Article, item, offre

**Achat**:
L'acte simulé d'un Participant qui achète le Produit épinglé d'un Live ; aucun argent ne circule.
_Avoid_: Commande, paiement, transaction

**Annonce d'achat**:
Le message que le Live publie de lui-même dans le chat à chaque Achat.
_Avoid_: Notification d'achat

### La modération

La modération ne vaut que pour un seul Live.

**Bannissement**:
L'exclusion d'un Participant d'un Live, sans possibilité d'y revenir.
_Avoid_: Kick, block

**Shadowban**:
L'état d'un Participant dont les messages restent visibles pour lui seul, sans qu'il le sache.
_Avoid_: Mute, ghost ban
