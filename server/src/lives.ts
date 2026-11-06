import type { Clock } from "./clock.js";
import type { LivekitPort } from "./livekit.js";
import { type Live, type LiveStore, newLiveId } from "./live-store.js";
import type { ErrorCode, LiveSummary, Participant, Role, ServerMessage } from "./protocol/index.js";

/** Socket d'un Participant, vu du Live : le transport reste hors de ce module. */
export interface Connection {
  send(message: ServerMessage): void;
  /** Fermeture normale (Live terminé, socket remplacé). */
  end(): void;
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

  constructor(
    private readonly store: LiveStore,
    private readonly livekit: LivekitPort,
    private readonly clock: Clock,
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
    if (inserted) return { live, created: true };

    // Lancement concurrent du même Hôte : l'autre l'a emporté, on rend son Live.
    await this.livekit.deleteRoom(live.id);
    const winner = await this.store.findRunningByHost(host.id);
    if (!winner) throw new Error(`Live en cours introuvable pour ${host.id}`);
    return { live: winner, created: false };
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
    }
    state.peakAudience = Math.max(state.peakAudience, audienceOf(state).total);

    connection.send(this.snapshot(state, presence, livekitToken));
    return { ok: true, presence };
  }

  /** Le socket de ce Participant s'est fermé (sauf s'il a déjà été remplacé). */
  leave(presence: Presence): void {
    const state = this.running.get(presence.liveId);
    if (state?.present.get(presence.participant.id) === presence) {
      state.present.delete(presence.participant.id);
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

    // Pendant l'écriture, les `join` sont refusés et l'état reste en mémoire :
    // aucun ne peut recharger le Live encore « en cours » en base.
    state.ending = true;
    try {
      await this.store.end(presence.liveId, "endedByHost", this.clock.now());
    } catch (error) {
      state.ending = false;
      throw error;
    }
    this.running.delete(presence.liveId);
    accepted();

    for (const other of state.present.values()) {
      other.connection.send(
        other.role === "host"
          ? {
              type: "liveEnded",
              reason: "endedByHost",
              summary: { purchases: 0, reactions: 0, peakAudience: state.peakAudience },
            }
          : { type: "liveEnded", reason: "endedByHost" },
      );
      other.connection.end();
    }
    await this.livekit.deleteRoom(presence.liveId);
    return { ok: true };
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
          const loaded: RunningLive = { live, present: new Map(), peakAudience: 0, ending: false };
          this.running.set(liveId, loaded);
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

/** Audience : Spectateurs connectés, Animateurs exclus, détaillée par App d'origine. */
function audienceOf(state: RunningLive): { total: number; byApp: Record<string, number> } {
  const byApp: Record<string, number> = {};
  let total = 0;
  for (const presence of state.present.values()) {
    if (presence.role !== "viewer") continue;
    byApp[presence.participant.app] = (byApp[presence.participant.app] ?? 0) + 1;
    total++;
  }
  return { total, byApp };
}
