import type { LiveContext } from "./live-context.js";
import type { StageCommands } from "./live-stage.js";
import {
  audienceOf,
  bannedFromLive,
  broadcast,
  cancelAllCohostGrace,
  cancelCohostGrace,
  CHAT_WINDOW_MS,
  type CommandResult,
  type Connection,
  GRACE_MS,
  type JoinResult,
  liveHeader,
  liveNotFound,
  notHost,
  type Presence,
  roleOf,
  type RunningLive,
  SNAPSHOT_MESSAGES,
  toHost,
} from "./live-state.js";
import { type EndReason, type Live, newLiveId } from "./live-store.js";
import { LiveModeration } from "./moderation.js";
import { SlidingWindow } from "./rate-limit.js";
import { LiveReactions } from "./reactions.js";
import { LiveShop } from "./shop.js";
import { LiveStage } from "./stage.js";
import type { EndSummary, LiveSummary, Participant, Role, ServerMessage } from "./protocol/index.js";

/** Un Live en cours vu par `GET /admin/state`. */
export interface LiveAdminState {
  id: string;
  title?: string;
  host: Participant;
  startedAt: string;
  hostConnected: boolean;
  audience: { total: number; byApp: Record<string, number> };
  /** Sockets ouverts dans ce Live, Animateurs compris. */
  connections: number;
}

/**
 * Cycle de vie des Lives : lancement idempotent, liste, présence des Participants
 * (`join`, `leave`, `snapshot`), Délai de grâce de l'Hôte et fin. Les Lives sont
 * persistés ; la présence vit en mémoire (ADR 0002).
 */
export class LiveLifecycle {
  /** Chargements en cours, pour que des `join` simultanés partagent le même état. */
  private readonly loading = new Map<string, Promise<RunningLive | undefined>>();

  constructor(
    private readonly ctx: LiveContext,
    private readonly stage: StageCommands,
  ) {}

  /**
   * Lance un Live pour cet Hôte, ou rend celui qu'il a déjà en cours (reprise
   * après un crash). `created` dit si le Live vient d'être créé.
   */
  async launch(host: Participant, title: string | undefined): Promise<{ live: Live; created: boolean }> {
    const { ctx } = this;
    const existing = await ctx.store.findRunningByHost(host.id);
    if (existing) return { live: existing, created: false };

    const live: Live = {
      id: newLiveId(),
      ...(title !== undefined && { title }),
      host,
      startedAt: ctx.clock.now(),
      reactionsTotal: 0,
      peakAudience: 0,
    };
    await ctx.livekit.createRoom(live.id);
    let inserted: Live | undefined;
    try {
      inserted = await ctx.store.insert(live);
    } catch (error) {
      await ctx.livekit.deleteRoom(live.id);
      throw error;
    }
    if (inserted) {
      // L'Hôte doit se connecter dans le Délai de grâce, sinon le Live se termine.
      await this.load(live.id);
      return { live, created: true };
    }

    // Lancement concurrent du même Hôte : l'autre l'a emporté, on rend son Live.
    await ctx.livekit.deleteRoom(live.id);
    const winner = await ctx.store.findRunningByHost(host.id);
    if (!winner) throw new Error(`Live en cours introuvable pour ${host.id}`);
    return { live: winner, created: false };
  }

  /**
   * Au démarrage : recharge les Lives en cours, dont les Participants vont refaire
   * `join`. Chacun se termine si son Hôte ne revient pas dans le Délai de grâce.
   */
  async resume(): Promise<void> {
    const lives = await this.ctx.store.listRunning();
    await Promise.all(lives.map((live) => this.load(live.id)));
  }

  /**
   * Arrêt du serveur, avant la fermeture des sockets : les minuteurs sont annulés
   * et n'en relancent plus, le total des Réactions et l'Audience maximale sont
   * écrits. Le prochain démarrage reprend les Lives en cours.
   */
  async stop(): Promise<void> {
    const { ctx } = this;
    ctx.stopped = true;
    const saves: Promise<void>[] = [];
    for (const state of ctx.running.values()) {
      state.hostGrace?.cancel();
      state.audienceTimer?.cancel();
      cancelAllCohostGrace(state);
      state.reactions.halt();
      // Le total des Réactions pas encore écrit l'est maintenant, pour que le redémarrage le retrouve.
      if (!state.ending) saves.push(state.reactions.save());
      if (state.peakSave) saves.push(state.peakSave);
    }
    const failures = (await Promise.allSettled(saves)).filter((result) => result.status === "rejected");
    for (const failure of failures) {
      ctx.log.error({ err: failure.reason }, "enregistrement du total des Réactions impossible à l'arrêt");
    }
  }

  /** Lives en cours, triés par Audience décroissante (les plus récents d'abord à égalité). */
  async list(): Promise<LiveSummary[]> {
    const lives = await this.ctx.store.listRunning();
    return lives
      .map((live) => this.summarize(live))
      .sort((a, b) => b.audience - a.audience || b.startedAt.localeCompare(a.startedAt));
  }

  /** État de tous les Lives en cours, pour l'exploitation (`GET /admin/state`). */
  async adminState(): Promise<LiveAdminState[]> {
    const lives = await this.ctx.store.listRunning();
    return lives.map((live) => {
      const state = this.ctx.running.get(live.id);
      return {
        ...liveHeader(live),
        host: live.host,
        hostConnected: state?.present.has(live.host.id) ?? false,
        audience: state ? audienceOf(state) : { total: 0, byApp: {} },
        connections: state?.present.size ?? 0,
      };
    });
  }

  summarize(live: Live): LiveSummary {
    const state = this.ctx.running.get(live.id);
    return {
      ...liveHeader(live),
      host: live.host,
      audience: state ? audienceOf(state).total : 0,
    };
  }

  /**
   * Récapitulatif d'un Live terminé, pour son Hôte seul : celui de `liveEnded`,
   * pour l'Hôte absent quand son Live s'est terminé par Délai de grâce. `undefined`
   * si le Live est inconnu, encore en cours, ou si `participant` n'en est pas l'Hôte.
   */
  async summary(liveId: string, participant: Participant): Promise<EndSummary | undefined> {
    const live = await this.ctx.store.findEnded(liveId);
    if (!live || live.host.id !== participant.id) return undefined;
    return {
      purchases: await this.ctx.products.countPurchases(liveId),
      reactions: live.reactionsTotal,
      peakAudience: live.peakAudience,
    };
  }

  /**
   * Fait entrer un Participant dans un Live et lui envoie le `snapshot`. Un
   * socket déjà ouvert par ce Participant reçoit `replaced` et se ferme.
   */
  async join(liveId: string, participant: Participant, connection: Connection): Promise<JoinResult> {
    const { ctx } = this;
    const state = await this.load(liveId);
    if (!state || state.ending) return liveNotFound;
    if (state.moderation.isBanned(participant.id)) return bannedFromLive;

    let role = roleOf(state, participant.id);
    let livekitToken = await this.issueLivekitToken(liveId, participant, role);
    // Montée ou descente pendant l'émission : le jeton suit le rôle à jour.
    if ((roleOf(state, participant.id) === "viewer") !== (role === "viewer")) {
      role = roleOf(state, participant.id);
      livekitToken = await this.issueLivekitToken(liveId, participant, role);
    }
    // Le Live a pu se terminer pendant l'émission du jeton.
    if (!ctx.isRunning(state)) return liveNotFound;
    // Banni pendant l'émission du jeton.
    if (state.moderation.isBanned(participant.id)) return bannedFromLive;
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
    ctx.audienceChanged(state);

    connection.send(this.snapshot(state, presence, livekitToken));
    return { ok: true, presence };
  }

  private issueLivekitToken(room: string, participant: Participant, role: Role): Promise<string> {
    const { id: identity, name } = participant;
    return this.ctx.livekit.issueToken({ room, identity, name, canPublish: role !== "viewer" });
  }

  /** Le socket de ce Participant s'est fermé (sauf s'il a déjà été remplacé). */
  leave(presence: Presence): void {
    const state = this.ctx.running.get(presence.liveId);
    if (state?.present.get(presence.participant.id) !== presence) return;
    state.present.delete(presence.participant.id);
    this.ctx.audienceChanged(state);
    if (state.stage.withdraw(presence.participant.id)) {
      toHost(state, { type: "joinRequestCancelled", participantId: presence.participant.id });
    }
    if (presence.role === "host") {
      broadcast(state, { type: "hostDisconnected" });
      this.startHostGrace(state);
    } else if (presence.role === "cohost") {
      this.stage.startCohostGrace(state, presence.participant.id);
    }
  }

  /**
   * L'Hôte termine son Live : fin enregistrée, `ack` (via `accepted`), puis
   * `liveEnded` à tous (récapitulatif pour l'Hôte), sockets fermés, room LiveKit supprimée.
   */
  async endLive(presence: Presence, accepted: () => void): Promise<CommandResult> {
    if (presence.role !== "host") return notHost;
    const state = this.ctx.runningFor(presence);
    if (!state) return liveNotFound;
    await this.finish(state, "endedByHost", accepted);
    return { ok: true };
  }

  private startHostGrace(state: RunningLive): void {
    const { ctx } = this;
    state.hostGrace?.cancel();
    if (ctx.stopped) return;
    state.hostGrace = ctx.clock.setTimeout(() => {
      state.hostGrace = undefined;
      if (!ctx.isRunning(state)) return;
      this.finish(state, "hostTimeout").catch((error: unknown) => {
        ctx.log.error({ err: error, liveId: state.live.id }, "fin du Live après le Délai de grâce impossible");
      });
    }, GRACE_MS);
  }

  /** Termine un Live : fin enregistrée, `onEnded`, puis `liveEnded` à tous, sockets fermés, room supprimée. */
  private async finish(state: RunningLive, reason: EndReason, onEnded: () => void = () => {}): Promise<void> {
    const { ctx } = this;
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
      await ctx.store.end(liveId, reason, ctx.clock.now(), state.reactions.total, state.peakAudience);
    } catch (error) {
      // Le Live continue : un Hôte toujours absent garde un Délai de grâce, et l'Audience reste diffusée.
      state.ending = false;
      if (!state.present.has(state.live.host.id)) this.startHostGrace(state);
      ctx.scheduleAudience(state);
      state.reactions.resume();
      throw error;
    }
    ctx.running.delete(liveId);
    onEnded();

    for (const other of state.present.values()) {
      other.connection.send(
        other.role === "host"
          ? {
              type: "liveEnded",
              reason,
              summary: {
                purchases: state.shop.purchases,
                reactions: state.reactions.total,
                peakAudience: state.peakAudience,
              },
            }
          : { type: "liveEnded", reason },
      );
      other.connection.end();
    }
    // Le Live est terminé quoi qu'il arrive : une room qui reste est seulement journalisée.
    try {
      await ctx.livekit.deleteRoom(liveId);
    } catch (error) {
      ctx.log.warn({ err: error, liveId }, "suppression de la room LiveKit impossible");
    }
  }

  private liveReactions(live: Live): LiveReactions {
    const { ctx } = this;
    return new LiveReactions(live.reactionsTotal, {
      clock: ctx.clock,
      allowed: ctx.config.reactions,
      broadcast: (counts, total) => {
        const state = ctx.running.get(live.id);
        if (state) broadcast(state, { type: "reactions", counts, total });
      },
      save: (total) => ctx.store.saveReactionsTotal(live.id, total),
      onSaveError: (error) => {
        ctx.log.error({ err: error, liveId: live.id }, "enregistrement du total des Réactions impossible");
      },
    });
  }

  private load(liveId: string): Promise<RunningLive | undefined> {
    const { ctx } = this;
    const state = ctx.running.get(liveId);
    if (state) return Promise.resolve(state);
    let pending = this.loading.get(liveId);
    if (!pending) {
      pending = Promise.all([
        ctx.store.findRunning(liveId),
        ctx.chat.recent(liveId, SNAPSHOT_MESSAGES),
        ctx.store.listCohosts(liveId),
        ctx.products.findPinned(liveId),
        ctx.products.countPurchases(liveId),
        ctx.moderation.lists(liveId),
      ])
        .then(([live, recentMessages, cohosts, pinned, purchases, moderation]) => {
          if (!live) return undefined;
          const loaded: RunningLive = {
            live,
            present: new Map(),
            // Redémarrage en plein Live : le sommet déjà atteint est conservé.
            peakAudience: live.peakAudience,
            peakSave: undefined,
            ending: false,
            hostGrace: undefined,
            audienceSent: { total: 0, byApp: {} },
            audienceTimer: undefined,
            recentMessages,
            chatWindow: new SlidingWindow(CHAT_WINDOW_MS),
            reactions: this.liveReactions(live),
            stage: new LiveStage(cohosts),
            cohostGrace: new Map(),
            shop: new LiveShop(pinned, purchases),
            moderation: new LiveModeration(moderation),
          };
          ctx.running.set(liveId, loaded);
          // Aucun Animateur n'est encore là (lancement, redémarrage) : leur Délai de grâce court dès maintenant.
          this.startHostGrace(loaded);
          for (const cohost of cohosts) this.stage.startCohostGrace(loaded, cohost.id);
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
      ...(state.shop.pinned && { pinnedProduct: state.shop.pinned }),
      audience: audienceOf(state),
      reactionsTotal: state.reactions.total,
      // Un message envoyé en Shadowban n'est servi qu'à son auteur.
      messages: state.recentMessages
        .filter(({ message, hidden }) => !hidden || message.author.id === presence.participant.id)
        .map(({ message }) => message),
      livekit: { url: this.ctx.livekit.url, token: livekitToken },
      // Demandes de montée pour l'Hôte seul, modération pour les Animateurs seuls.
      ...(presence.role === "host" && { joinRequests: state.stage.joinRequests }),
      ...(presence.role !== "viewer" && { moderation: state.moderation.lists }),
    };
  }
}
