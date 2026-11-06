import type { Clock, Timer } from "./clock.js";
import type { LivekitPort } from "./livekit.js";
import { type EndReason, type Live, type LiveStore, newLiveId } from "./live-store.js";
import type { ErrorCode, LiveSummary, Participant, Role, ServerMessage } from "./protocol/index.js";

/** Socket d'un Participant, vu du Live : le transport reste hors de ce module. */
export interface Connection {
  send(message: ServerMessage): void;
  /** Fermeture normale (Live terminé, socket remplacé). */
  end(): void;
}

/** Délai de grâce de l'Hôte : sans retour dans ce délai, son Live se termine. */
export const HOST_GRACE_MS = 60_000;
/** L'Audience est diffusée au plus à cette cadence, et seulement si elle a changé. */
export const AUDIENCE_INTERVAL_MS = 2_000;

type Audience = Omit<Extract<ServerMessage, { type: "audience" }>, "type">;

/** Journal des erreurs survenues hors d'une requête (minuteurs). */
export interface Logger {
  error(details: object, message: string): void;
}

/** Présence d'un Participant dans un Live, par son socket. */
export interface Presence {
  readonly liveId: string;
  readonly participant: Participant;
  readonly role: Role;
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
}

export type JoinResult = { ok: true; presence: Presence } | { ok: false; code: ErrorCode; message: string };
export type CommandResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

const liveNotFound = { ok: false, code: "live_not_found", message: "Ce Live n'existe pas ou est terminé." } as const;

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

  constructor(
    private readonly store: LiveStore,
    private readonly livekit: LivekitPort,
    private readonly clock: Clock,
    private readonly log: Logger,
  ) {}

  /**
   * Lance un Live pour cet Hôte, ou rend celui qu'il a déjà en cours (reprise
   * après un crash). `created` dit si le Live vient d'être créé.
   */
  async launch(host: Participant, title: string | undefined): Promise<{ live: Live; created: boolean }> {
    const existing = await this.store.findRunningByHost(host.id);
    if (existing) return { live: existing, created: false };

    const live: Live = { id: newLiveId(), ...(title !== undefined && { title }), host, startedAt: this.clock.now() };
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
   * et n'en relancent plus. Le prochain démarrage reprend les Lives en cours.
   */
  stop(): void {
    this.stopped = true;
    for (const state of this.running.values()) {
      state.hostGrace?.cancel();
      state.audienceTimer?.cancel();
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

    const role: Role = participant.id === state.live.host.id ? "host" : "viewer";
    const livekitToken = await this.livekit.issueToken({
      room: liveId,
      identity: participant.id,
      name: participant.name,
      canPublish: role === "host",
    });
    // Le Live a pu se terminer pendant l'émission du jeton.
    if (this.running.get(liveId) !== state || state.ending) return liveNotFound;

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
    state.peakAudience = Math.max(state.peakAudience, audienceOf(state).total);
    this.scheduleAudience(state);

    connection.send(this.snapshot(state, presence, livekitToken));
    return { ok: true, presence };
  }

  /** Le socket de ce Participant s'est fermé (sauf s'il a déjà été remplacé). */
  leave(presence: Presence): void {
    const state = this.running.get(presence.liveId);
    if (state?.present.get(presence.participant.id) !== presence) return;
    state.present.delete(presence.participant.id);
    this.scheduleAudience(state);
    if (presence.role === "host") {
      broadcast(state, { type: "hostDisconnected" });
      this.startHostGrace(state);
    }
  }

  /**
   * L'Hôte termine son Live : fin enregistrée, `ack` (via `accepted`), puis
   * `liveEnded` à tous (récapitulatif pour l'Hôte), sockets fermés, room LiveKit supprimée.
   */
  async endLive(presence: Presence, accepted: () => void): Promise<CommandResult> {
    if (presence.role !== "host") {
      return { ok: false, code: "not_host", message: "Seul l'Hôte peut terminer le Live." };
    }
    const state = this.running.get(presence.liveId);
    if (!state || state.ending) return liveNotFound;
    await this.finish(state, "endedByHost", accepted);
    return { ok: true };
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

  private startHostGrace(state: RunningLive): void {
    state.hostGrace?.cancel();
    if (this.stopped) return;
    state.hostGrace = this.clock.setTimeout(() => {
      state.hostGrace = undefined;
      if (state.ending || this.running.get(state.live.id) !== state) return;
      this.finish(state, "hostTimeout").catch((error: unknown) => {
        this.log.error({ err: error, liveId: state.live.id }, "fin du Live après le Délai de grâce impossible");
      });
    }, HOST_GRACE_MS);
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
    try {
      await this.store.end(liveId, reason, this.clock.now());
    } catch (error) {
      // Le Live continue : un Hôte toujours absent garde un Délai de grâce, et l'Audience reste diffusée.
      state.ending = false;
      if (!state.present.has(state.live.host.id)) this.startHostGrace(state);
      this.scheduleAudience(state);
      throw error;
    }
    this.running.delete(liveId);
    onEnded();

    for (const other of state.present.values()) {
      other.connection.send(
        other.role === "host"
          ? { type: "liveEnded", reason, summary: { purchases: 0, reactions: 0, peakAudience: state.peakAudience } }
          : { type: "liveEnded", reason },
      );
      other.connection.end();
    }
    await this.livekit.deleteRoom(liveId);
  }

  private load(liveId: string): Promise<RunningLive | undefined> {
    const state = this.running.get(liveId);
    if (state) return Promise.resolve(state);
    let pending = this.loading.get(liveId);
    if (!pending) {
      pending = this.store
        .findRunning(liveId)
        .then((live) => {
          if (!live) return undefined;
          const loaded: RunningLive = {
            live,
            present: new Map(),
            peakAudience: 0,
            ending: false,
            hostGrace: undefined,
            audienceSent: { total: 0, byApp: {} },
            audienceTimer: undefined,
          };
          this.running.set(liveId, loaded);
          // L'Hôte n'est pas encore là (redémarrage, reprise) : son Délai de grâce court dès maintenant.
          this.startHostGrace(loaded);
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
      cohosts: [],
      audience: audienceOf(state),
      reactionsTotal: 0,
      messages: [],
      livekit: { url: this.livekit.url, token: livekitToken },
      // Demandes de montée pour l'Hôte seul, modération pour les Animateurs seuls.
      ...(presence.role === "host" && { joinRequests: [], moderation: { shadowbanned: [], banned: [] } }),
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
