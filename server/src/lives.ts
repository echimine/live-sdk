import { chatText, newMessageId } from "./chat.js";
import type { ChatStore } from "./chat-store.js";
import type { Clock, Timer } from "./clock.js";
import type { LivekitPort } from "./livekit.js";
import { SlidingWindow } from "./rate-limit.js";
import { LiveReactions } from "./reactions.js";
import { LiveStage, MAX_COHOSTS } from "./stage.js";
import { type EndReason, type Live, type LiveStore, newLiveId } from "./live-store.js";
import type { ChatMessage, Config, ErrorCode, LiveSummary, Participant, Role, ServerMessage } from "./protocol/index.js";

/** Socket d'un Participant, vu du Live : le transport reste hors de ce module. */
export interface Connection {
  send(message: ServerMessage): void;
  /** Fermeture normale (Live terminé, socket remplacé). */
  end(): void;
}

/**
 * Délai de grâce d'un Animateur déconnecté : sans retour dans ce délai, le Live
 * de l'Hôte se termine et un Co-hôte redevient Spectateur.
 */
export const GRACE_MS = 60_000;
/** L'Audience est diffusée au plus à cette cadence, et seulement si elle a changé. */
export const AUDIENCE_INTERVAL_MS = 2_000;
/** Limite du chat : messages par fenêtre glissante, selon le rôle. */
export const CHAT_WINDOW_MS = 10_000;
export const CHAT_LIMIT: Record<Role, number> = { viewer: 5, cohost: 20, host: 20 };
/** Messages du chat servis dans le `snapshot`. */
export const SNAPSHOT_MESSAGES = 50;

type Audience = Omit<Extract<ServerMessage, { type: "audience" }>, "type">;

/** Journal des erreurs survenues hors d'une requête (minuteurs). */
export interface Logger {
  error(details: object, message: string): void;
}

/** Présence d'un Participant dans un Live, par son socket. */
export interface Presence {
  readonly liveId: string;
  readonly participant: Participant;
  /** Change sans reconnexion quand un Spectateur monte à l'écran ou en redescend. */
  role: Role;
  readonly connection: Connection;
}

/** État en mémoire d'un Live en cours. */
interface RunningLive {
  live: Live;
  /** Une seule présence par Participant : le dernier `join` remplace le précédent. */
  present: Map<string, Presence>;
  peakAudience: number;
  ending: boolean;
  /** Délai de grâce en cours, tant que l'Hôte n'est pas connecté. */
  hostGrace: Timer | undefined;
  /** Dernière Audience diffusée, et prochaine diffusion prévue. */
  audienceSent: Audience;
  audienceTimer: Timer | undefined;
  /**
   * Derniers messages du chat, tenus à jour avec les diffusions : le `snapshot`
   * les sert sans relire la base, donc sans manquer un message envoyé entre-temps.
   */
  recentMessages: ChatMessage[];
  /** Messages récents de chaque Participant, pour la limite du chat. */
  chatWindow: SlidingWindow;
  /** Réactions : agrégation, diffusion et total conservé. */
  reactions: LiveReactions;
  /** Co-hôtes et Demandes de montée. */
  stage: LiveStage;
  /** Délais de grâce des Co-hôtes déconnectés. */
  cohostGrace: Map<string, Timer>;
}

export type JoinResult = { ok: true; presence: Presence } | { ok: false; code: ErrorCode; message: string };
export type CommandResult =
  | { ok: true }
  | { ok: false; code: Exclude<ErrorCode, "rate_limited">; message: string }
  | { ok: false; code: "rate_limited"; message: string; retryAfterMs: number };

const liveNotFound = { ok: false, code: "live_not_found", message: "Ce Live n'existe pas ou est terminé." } as const;
const notHost = { ok: false, code: "not_host", message: "Seul l'Hôte peut faire cela." } as const;
const noJoinRequest = { ok: false, code: "not_found", message: "Aucune Demande de montée de ce Participant." } as const;

export interface LivesDeps {
  store: LiveStore;
  chat: ChatStore;
  livekit: LivekitPort;
  clock: Clock;
  log: Logger;
  /** Config servie aux SDK : le serveur applique les mêmes limites. */
  config: Config;
}

/**
 * Cycle de vie des Lives : lancement idempotent, liste, présence des Participants
 * et fin. Les Lives sont persistés ; la présence vit en mémoire (ADR 0002).
 */
export class Lives {
  private readonly running = new Map<string, RunningLive>();
  /** Chargements en cours, pour que des `join` simultanés partagent le même état. */
  private readonly loading = new Map<string, Promise<RunningLive | undefined>>();
  /** Arrêt du serveur : plus aucun minuteur ne doit tourner. */
  private stopped = false;

  private readonly store: LiveStore;
  private readonly chat: ChatStore;
  private readonly livekit: LivekitPort;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly config: Config;

  constructor(deps: LivesDeps) {
    this.store = deps.store;
    this.chat = deps.chat;
    this.livekit = deps.livekit;
    this.clock = deps.clock;
    this.log = deps.log;
    this.config = deps.config;
  }

  /**
   * Lance un Live pour cet Hôte, ou rend celui qu'il a déjà en cours (reprise
   * après un crash). `created` dit si le Live vient d'être créé.
   */
  async launch(host: Participant, title: string | undefined): Promise<{ live: Live; created: boolean }> {
    const existing = await this.store.findRunningByHost(host.id);
    if (existing) return { live: existing, created: false };

    const live: Live = {
      id: newLiveId(),
      ...(title !== undefined && { title }),
      host,
      startedAt: this.clock.now(),
      reactionsTotal: 0,
    };
    await this.livekit.createRoom(live.id);
    let inserted: Live | undefined;
    try {
      inserted = await this.store.insert(live);
    } catch (error) {
      await this.livekit.deleteRoom(live.id);
      throw error;
    }
    if (inserted) {
      // L'Hôte doit se connecter dans le Délai de grâce, sinon le Live se termine.
      await this.load(live.id);
      return { live, created: true };
    }

    // Lancement concurrent du même Hôte : l'autre l'a emporté, on rend son Live.
    await this.livekit.deleteRoom(live.id);
    const winner = await this.store.findRunningByHost(host.id);
    if (!winner) throw new Error(`Live en cours introuvable pour ${host.id}`);
    return { live: winner, created: false };
  }

  /**
   * Au démarrage : recharge les Lives en cours, dont les Participants vont refaire
   * `join`. Chacun se termine si son Hôte ne revient pas dans le Délai de grâce.
   */
  async resume(): Promise<void> {
    const lives = await this.store.listRunning();
    await Promise.all(lives.map((live) => this.load(live.id)));
  }

  /**
   * Arrêt du serveur, avant la fermeture des sockets : les minuteurs sont annulés
   * et n'en relancent plus, le total des Réactions est écrit. Le prochain démarrage
   * reprend les Lives en cours.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    const saves: Promise<void>[] = [];
    for (const state of this.running.values()) {
      state.hostGrace?.cancel();
      state.audienceTimer?.cancel();
      cancelAllCohostGrace(state);
      state.reactions.halt();
      // Le total des Réactions pas encore écrit l'est maintenant, pour que le redémarrage le retrouve.
      if (!state.ending) saves.push(state.reactions.save());
    }
    const failures = (await Promise.allSettled(saves)).filter((result) => result.status === "rejected");
    for (const failure of failures) {
      this.log.error({ err: failure.reason }, "enregistrement du total des Réactions impossible à l'arrêt");
    }
  }

  /** Lives en cours, triés par Audience décroissante (les plus récents d'abord à égalité). */
  async list(): Promise<LiveSummary[]> {
    const lives = await this.store.listRunning();
    return lives
      .map((live) => this.summarize(live))
      .sort((a, b) => b.audience - a.audience || b.startedAt.localeCompare(a.startedAt));
  }

  summarize(live: Live): LiveSummary {
    const state = this.running.get(live.id);
    return {
      ...liveHeader(live),
      host: live.host,
      audience: state ? audienceOf(state).total : 0,
    };
  }

  /**
   * Fait entrer un Participant dans un Live et lui envoie le `snapshot`. Un
   * socket déjà ouvert par ce Participant reçoit `replaced` et se ferme.
   */
  async join(liveId: string, participant: Participant, connection: Connection): Promise<JoinResult> {
    const state = await this.load(liveId);
    if (!state || state.ending) return liveNotFound;

    let role = roleOf(state, participant.id);
    let livekitToken = await this.issueLivekitToken(liveId, participant, role);
    // Montée ou descente pendant l'émission : le jeton suit le rôle à jour.
    if ((roleOf(state, participant.id) === "viewer") !== (role === "viewer")) {
      role = roleOf(state, participant.id);
      livekitToken = await this.issueLivekitToken(liveId, participant, role);
    }
    // Le Live a pu se terminer pendant l'émission du jeton.
    if (this.running.get(liveId) !== state || state.ending) return liveNotFound;
    role = roleOf(state, participant.id);

    const presence: Presence = { liveId, participant, role, connection };
    const previous = state.present.get(participant.id);
    state.present.set(participant.id, presence);
    if (previous) {
      previous.connection.send({ type: "replaced" });
      previous.connection.end();
    } else if (role === "host") {
      state.hostGrace?.cancel();
      state.hostGrace = undefined;
      broadcast(state, { type: "hostReconnected" }, presence);
    }
    cancelCohostGrace(state, participant.id);
    state.peakAudience = Math.max(state.peakAudience, audienceOf(state).total);
    this.scheduleAudience(state);

    connection.send(this.snapshot(state, presence, livekitToken));
    return { ok: true, presence };
  }

  /** Le Live en cours de cette présence, s'il n'est pas en train de se terminer. */
  private runningFor(presence: Presence): RunningLive | undefined {
    const state = this.running.get(presence.liveId);
    return state && !state.ending ? state : undefined;
  }

  private issueLivekitToken(room: string, participant: Participant, role: Role): Promise<string> {
    const { id: identity, name } = participant;
    return this.livekit.issueToken({ room, identity, name, canPublish: role !== "viewer" });
  }

  /** Le socket de ce Participant s'est fermé (sauf s'il a déjà été remplacé). */
  leave(presence: Presence): void {
    const state = this.running.get(presence.liveId);
    if (state?.present.get(presence.participant.id) !== presence) return;
    state.present.delete(presence.participant.id);
    this.scheduleAudience(state);
    if (state.stage.withdraw(presence.participant.id)) {
      toHost(state, { type: "joinRequestCancelled", participantId: presence.participant.id });
    }
    if (presence.role === "host") {
      broadcast(state, { type: "hostDisconnected" });
      this.startHostGrace(state);
    } else if (presence.role === "cohost") {
      this.startCohostGrace(state, presence.participant.id);
    }
  }

  /**
   * L'Hôte termine son Live : fin enregistrée, `ack` (via `accepted`), puis
   * `liveEnded` à tous (récapitulatif pour l'Hôte), sockets fermés, room LiveKit supprimée.
   */
  async endLive(presence: Presence, accepted: () => void): Promise<CommandResult> {
    if (presence.role !== "host") return notHost;
    const state = this.runningFor(presence);
    if (!state) return liveNotFound;
    await this.finish(state, "endedByHost", accepted);
    return { ok: true };
  }

  /** Un Participant écrit dans le chat : `ack` (via `accepted`), puis `chatMessage` à tous, auteur compris. */
  async sendMessage(presence: Presence, text: string, accepted: () => void): Promise<CommandResult> {
    const state = this.runningFor(presence);
    if (!state) return liveNotFound;
    const visible = chatText(text, this.config.chat.maxLength);
    if (visible === undefined) {
      const max = this.config.chat.maxLength;
      return { ok: false, code: "invalid_message", message: `Message vide ou de plus de ${max} caractères.` };
    }
    const author = presence.participant.id;
    const sentAt = this.clock.now();
    const retryAfterMs = state.chatWindow.take(author, CHAT_LIMIT[presence.role], sentAt);
    if (retryAfterMs !== undefined) {
      const limit = CHAT_LIMIT[presence.role];
      return { ok: false, code: "rate_limited", message: `Doucement… (${limit} messages par 10 s)`, retryAfterMs };
    }
    const message = {
      id: newMessageId(),
      kind: "text",
      author: presence.participant,
      role: presence.role,
      text: visible,
      at: sentAt.toISOString(),
    } satisfies ChatMessage;
    try {
      await this.chat.insert(state.live.id, message);
    } catch (error) {
      // Message perdu : il ne compte pas dans la limite.
      state.chatWindow.giveBack(author, sentAt);
      throw error;
    }
    // Le Live a pu se terminer pendant l'écriture : le message est conservé, sans diffusion.
    if (state.ending || this.running.get(state.live.id) !== state) return liveNotFound;
    state.recentMessages = [...state.recentMessages, message].slice(-SNAPSHOT_MESSAGES);
    accepted();
    broadcast(state, { type: "chatMessage", message });
    return { ok: true };
  }

  /**
   * Un Animateur supprime un message : suppression marquée, `ack` (via `accepted`),
   * puis `messageDeleted` à tous. Le message sort des `snapshot` suivants.
   */
  async deleteMessage(presence: Presence, messageId: string, accepted: () => void): Promise<CommandResult> {
    if (presence.role === "viewer") {
      return { ok: false, code: "not_animator", message: "Seuls les Animateurs peuvent supprimer un message." };
    }
    const state = this.runningFor(presence);
    if (!state) return liveNotFound;
    if (!(await this.chat.markDeleted(state.live.id, messageId, this.clock.now()))) {
      return { ok: false, code: "not_found", message: "Message introuvable." };
    }
    state.recentMessages = state.recentMessages.filter((message) => message.id !== messageId);
    // Complété avant l'annonce : qui rejoint après `messageDeleted` reçoit bien 50 messages.
    // La suppression est faite : un échec du complément ne la remet pas en cause.
    await this.refillRecentMessages(state).catch((error: unknown) => {
      this.log.error({ err: error, liveId: state.live.id }, "relecture des derniers messages impossible");
    });
    // Le Live a pu se terminer pendant les écritures : la suppression est conservée, sans diffusion.
    if (state.ending || this.running.get(state.live.id) !== state) return liveNotFound;
    accepted();
    broadcast(state, { type: "messageDeleted", messageId });
    return { ok: true };
  }

  /**
   * Après une suppression, complète les derniers messages depuis la base pour que
   * le `snapshot` en serve toujours `SNAPSHOT_MESSAGES`. Seuls des messages plus
   * anciens que le plus ancien gardé en mémoire sont ajoutés : un plus récent qui
   * n'y est pas a été supprimé, et un message envoyé pendant la lecture y est déjà.
   */
  private async refillRecentMessages(state: RunningLive): Promise<void> {
    const stored = await this.chat.recent(state.live.id, SNAPSHOT_MESSAGES);
    const current = state.recentMessages;
    const oldestKept = current[0];
    const olderCount = oldestKept === undefined ? stored.length : stored.findIndex((m) => m.id === oldestKept.id);
    // Le plus ancien gardé n'est plus en base (supprimé pendant la lecture) : on laisse la mémoire telle quelle.
    if (olderCount <= 0) return;
    state.recentMessages = [...stored.slice(0, olderCount), ...current].slice(-SNAPSHOT_MESSAGES);
  }

  /** Un Spectateur demande à monter à l'écran : `ack`, puis `joinRequested` chez l'Hôte (une seule fois). */
  requestToJoin(presence: Presence, accepted: () => void): CommandResult {
    if (presence.role !== "viewer") {
      return { ok: false, code: "invalid_command", message: "Seul un Spectateur peut demander à monter." };
    }
    const state = this.runningFor(presence);
    if (!state) return liveNotFound;
    const isNew = state.stage.request(presence.participant);
    accepted();
    if (isNew) toHost(state, { type: "joinRequested", participant: presence.participant });
    return { ok: true };
  }

  /** Le Spectateur annule sa Demande de montée : `ack`, puis `joinRequestCancelled` chez l'Hôte. */
  cancelJoinRequest(presence: Presence, accepted: () => void): CommandResult {
    const state = this.runningFor(presence);
    if (!state) return liveNotFound;
    const withdrawn = state.stage.withdraw(presence.participant.id);
    accepted();
    if (withdrawn) toHost(state, { type: "joinRequestCancelled", participantId: presence.participant.id });
    return { ok: true };
  }

  /**
   * L'Hôte accepte une Demande de montée : `ack`, puis `roleChanged` à tous. Le
   * Co-hôte publie sans nouveau jeton : sa permission change via LiveKit.
   */
  async acceptJoin(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    if (presence.role !== "host") return notHost;
    const state = this.runningFor(presence);
    if (!state) return liveNotFound;
    const requester = state.stage.requestOf(participantId);
    if (!requester) return noJoinRequest;
    if (state.stage.isFull) {
      return { ok: false, code: "cohost_limit", message: `Déjà ${MAX_COHOSTS} Co-hôtes à l'écran.` };
    }
    // Place réservée en mémoire avant l'écriture : deux acceptations simultanées ne dépassent pas la limite.
    state.stage.promote(requester);
    try {
      await this.store.addCohost(state.live.id, requester, this.clock.now());
    } catch (error) {
      state.stage.undoPromote(requester, state.present.has(requester.id));
      throw error;
    }
    // Permission ouverte avant l'annonce : le Co-hôte peut publier dès qu'il reçoit `roleChanged`.
    await this.updateCanPublish(state, requester.id, true);
    if (state.ending || this.running.get(state.live.id) !== state) return liveNotFound;
    this.setRole(state, requester, "cohost");
    // Parti pendant l'acceptation : Co-hôte absent, son Délai de grâce court.
    if (!state.present.has(requester.id)) this.startCohostGrace(state, requester.id);
    accepted();
    broadcast(state, { type: "roleChanged", participant: requester, role: "cohost" });
    return { ok: true };
  }

  /** L'Hôte refuse une Demande de montée : elle disparaît, `ack`. */
  declineJoin(presence: Presence, participantId: string, accepted: () => void): CommandResult {
    if (presence.role !== "host") return notHost;
    const state = this.runningFor(presence);
    if (!state) return liveNotFound;
    if (!state.stage.withdraw(participantId)) return noJoinRequest;
    accepted();
    return { ok: true };
  }

  /** Le Co-hôte redescend de lui-même : `ack`, puis `roleChanged` vers Spectateur à tous. */
  async leaveStage(presence: Presence, accepted: () => void): Promise<CommandResult> {
    if (presence.role !== "cohost") {
      return { ok: false, code: "invalid_command", message: "Seul un Co-hôte peut redescendre." };
    }
    const state = this.runningFor(presence);
    if (!state) return liveNotFound;
    return this.demote(state, presence.participant.id, accepted);
  }

  /** L'Hôte retire un Co-hôte, même absent : `ack`, puis `roleChanged` vers Spectateur à tous. */
  async removeCohost(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    if (presence.role !== "host") return notHost;
    const state = this.runningFor(presence);
    if (!state) return liveNotFound;
    return this.demote(state, participantId, accepted);
  }

  /**
   * Fait redescendre un Co-hôte, même absent : `onDemoted`, puis `roleChanged` vers
   * Spectateur à tous, publication fermée. `not_found` s'il n'est pas (ou plus) Co-hôte.
   */
  private async demote(
    state: RunningLive,
    participantId: string,
    onDemoted: () => void = () => {},
  ): Promise<CommandResult> {
    const removed = state.stage.demote(participantId);
    if (!removed) return { ok: false, code: "not_found", message: "Ce Participant n'est pas Co-hôte." };
    cancelCohostGrace(state, participantId);
    try {
      await this.store.removeCohost(state.live.id, participantId);
    } catch (error) {
      state.stage.undoDemote(removed);
      throw error;
    }
    // Le Live a pu se terminer pendant l'écriture : la descente est conservée, sans annonce.
    if (state.ending || this.running.get(state.live.id) !== state) return liveNotFound;
    this.setRole(state, removed.cohost, "viewer");
    onDemoted();
    broadcast(state, { type: "roleChanged", participant: removed.cohost, role: "viewer" });
    await this.updateCanPublish(state, participantId, false);
    return { ok: true };
  }

  /** Change le rôle d'un Participant présent ; l'Audience suit (les Animateurs n'y comptent pas). */
  private setRole(state: RunningLive, participant: Participant, role: Role): void {
    const presence = state.present.get(participant.id);
    if (presence) presence.role = role;
    this.scheduleAudience(state);
  }

  /**
   * Ouvre ou ferme la publication d'un Participant dans la room LiveKit. Un échec
   * (Participant pas encore connecté au média…) est journalisé : son prochain
   * `join` lui donne un jeton à jour.
   */
  private async updateCanPublish(state: RunningLive, participantId: string, canPublish: boolean): Promise<void> {
    try {
      await this.livekit.setCanPublish(state.live.id, participantId, canPublish);
    } catch (error) {
      this.log.error({ err: error, liveId: state.live.id }, "changement de la permission de publier impossible");
    }
  }

  /** Un Participant envoie une Réaction : sans `ack`, diffusée à tous avec les autres (voir `LiveReactions`). */
  react(presence: Presence, emoji: string): void {
    const state = this.running.get(presence.liveId);
    if (state && !state.ending) state.reactions.add(presence.participant.id, emoji);
  }

  /** Prévoit une diffusion de l'Audience, au plus tôt `AUDIENCE_INTERVAL_MS` après la précédente. */
  private scheduleAudience(state: RunningLive): void {
    if (state.audienceTimer || state.ending || this.stopped) return;
    state.audienceTimer = this.clock.setTimeout(() => {
      state.audienceTimer = undefined;
      const audience = audienceOf(state);
      if (sameAudience(audience, state.audienceSent)) return;
      state.audienceSent = audience;
      broadcast(state, { type: "audience", ...audience });
    }, AUDIENCE_INTERVAL_MS);
  }

  /** Sans retour dans le Délai de grâce, ce Co-hôte redevient Spectateur. */
  private startCohostGrace(state: RunningLive, participantId: string): void {
    cancelCohostGrace(state, participantId);
    if (this.stopped) return;
    const timer = this.clock.setTimeout(() => {
      state.cohostGrace.delete(participantId);
      if (state.ending || this.running.get(state.live.id) !== state) return;
      this.demote(state, participantId).catch((error: unknown) => {
        const liveId = state.live.id;
        this.log.error({ err: error, liveId }, "retour d'un Co-hôte absent parmi les Spectateurs impossible");
      });
    }, GRACE_MS);
    state.cohostGrace.set(participantId, timer);
  }

  private startHostGrace(state: RunningLive): void {
    state.hostGrace?.cancel();
    if (this.stopped) return;
    state.hostGrace = this.clock.setTimeout(() => {
      state.hostGrace = undefined;
      if (state.ending || this.running.get(state.live.id) !== state) return;
      this.finish(state, "hostTimeout").catch((error: unknown) => {
        this.log.error({ err: error, liveId: state.live.id }, "fin du Live après le Délai de grâce impossible");
      });
    }, GRACE_MS);
  }

  /** Termine un Live : fin enregistrée, `onEnded`, puis `liveEnded` à tous, sockets fermés, room supprimée. */
  private async finish(state: RunningLive, reason: EndReason, onEnded: () => void = () => {}): Promise<void> {
    const liveId = state.live.id;
    // Pendant l'écriture, les `join` sont refusés et l'état reste en mémoire :
    // aucun ne peut recharger le Live encore « en cours » en base.
    state.ending = true;
    state.hostGrace?.cancel();
    state.hostGrace = undefined;
    state.audienceTimer?.cancel();
    state.audienceTimer = undefined;
    state.reactions.halt();
    cancelAllCohostGrace(state);
    try {
      await this.store.end(liveId, reason, this.clock.now(), state.reactions.total);
    } catch (error) {
      // Le Live continue : un Hôte toujours absent garde un Délai de grâce, et l'Audience reste diffusée.
      state.ending = false;
      if (!state.present.has(state.live.host.id)) this.startHostGrace(state);
      this.scheduleAudience(state);
      state.reactions.resume();
      throw error;
    }
    this.running.delete(liveId);
    onEnded();

    for (const other of state.present.values()) {
      other.connection.send(
        other.role === "host"
          ? {
              type: "liveEnded",
              reason,
              summary: { purchases: 0, reactions: state.reactions.total, peakAudience: state.peakAudience },
            }
          : { type: "liveEnded", reason },
      );
      other.connection.end();
    }
    await this.livekit.deleteRoom(liveId);
  }

  private liveReactions(live: Live): LiveReactions {
    return new LiveReactions(live.reactionsTotal, {
      clock: this.clock,
      allowed: this.config.reactions,
      broadcast: (counts, total) => {
        const state = this.running.get(live.id);
        if (state) broadcast(state, { type: "reactions", counts, total });
      },
      save: (total) => this.store.saveReactionsTotal(live.id, total),
      onSaveError: (error) => {
        this.log.error({ err: error, liveId: live.id }, "enregistrement du total des Réactions impossible");
      },
    });
  }

  private load(liveId: string): Promise<RunningLive | undefined> {
    const state = this.running.get(liveId);
    if (state) return Promise.resolve(state);
    let pending = this.loading.get(liveId);
    if (!pending) {
      pending = Promise.all([
        this.store.findRunning(liveId),
        this.chat.recent(liveId, SNAPSHOT_MESSAGES),
        this.store.listCohosts(liveId),
      ])
        .then(([live, recentMessages, cohosts]) => {
          if (!live) return undefined;
          const loaded: RunningLive = {
            live,
            present: new Map(),
            peakAudience: 0,
            ending: false,
            hostGrace: undefined,
            audienceSent: { total: 0, byApp: {} },
            audienceTimer: undefined,
            recentMessages,
            chatWindow: new SlidingWindow(CHAT_WINDOW_MS),
            reactions: this.liveReactions(live),
            stage: new LiveStage(cohosts),
            cohostGrace: new Map(),
          };
          this.running.set(liveId, loaded);
          // Aucun Animateur n'est encore là (lancement, redémarrage) : leur Délai de grâce court dès maintenant.
          this.startHostGrace(loaded);
          for (const cohost of cohosts) this.startCohostGrace(loaded, cohost.id);
          return loaded;
        })
        .finally(() => this.loading.delete(liveId));
      this.loading.set(liveId, pending);
    }
    return pending;
  }

  private snapshot(state: RunningLive, presence: Presence, livekitToken: string): ServerMessage {
    const { live } = state;
    const { id, title, startedAt } = liveHeader(live);
    return {
      type: "snapshot",
      live: { id, ...(title !== undefined && { title }), startedAt },
      you: presence.participant,
      role: presence.role,
      host: live.host,
      hostConnected: state.present.has(live.host.id),
      cohosts: state.stage.cohosts,
      audience: audienceOf(state),
      reactionsTotal: state.reactions.total,
      messages: state.recentMessages,
      livekit: { url: this.livekit.url, token: livekitToken },
      // Demandes de montée pour l'Hôte seul, modération pour les Animateurs seuls.
      ...(presence.role === "host" && { joinRequests: state.stage.joinRequests }),
      ...(presence.role !== "viewer" && { moderation: { shadowbanned: [], banned: [] } }),
    };
  }
}

/** Identifiant, titre éventuel et début d'un Live, tels qu'ils partent sur le fil. */
function liveHeader(live: Live): { id: string; title?: string; startedAt: string } {
  return { id: live.id, ...(live.title !== undefined && { title: live.title }), startedAt: live.startedAt.toISOString() };
}

/** Envoie un message à tous les Participants présents, sauf `except`. */
function broadcast(state: RunningLive, message: ServerMessage, except?: Presence): void {
  for (const presence of state.present.values()) {
    if (presence !== except) presence.connection.send(message);
  }
}

/** Rôle d'un Participant dans ce Live : décidé par le serveur seul. */
function roleOf(state: RunningLive, participantId: string): Role {
  if (participantId === state.live.host.id) return "host";
  return state.stage.isCohost(participantId) ? "cohost" : "viewer";
}

function cancelCohostGrace(state: RunningLive, participantId: string): void {
  state.cohostGrace.get(participantId)?.cancel();
  state.cohostGrace.delete(participantId);
}

function cancelAllCohostGrace(state: RunningLive): void {
  for (const timer of state.cohostGrace.values()) timer.cancel();
  state.cohostGrace.clear();
}

/** Envoie un message à l'Hôte, s'il est connecté. */
function toHost(state: RunningLive, message: ServerMessage): void {
  state.present.get(state.live.host.id)?.connection.send(message);
}

/** Audience : Spectateurs connectés, Animateurs exclus, détaillée par App d'origine. */
function audienceOf(state: RunningLive): Audience {
  const byApp: Record<string, number> = {};
  let total = 0;
  for (const presence of state.present.values()) {
    if (presence.role !== "viewer") continue;
    byApp[presence.participant.app] = (byApp[presence.participant.app] ?? 0) + 1;
    total++;
  }
  return { total, byApp };
}

/** Même total et même détail par App d'origine. */
function sameAudience(a: Audience, b: Audience): boolean {
  const apps = Object.keys(a.byApp);
  return a.total === b.total && apps.length === Object.keys(b.byApp).length && apps.every((app) => a.byApp[app] === b.byApp[app]);
}
