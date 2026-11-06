import type { LiveContext } from "./live-context.js";
import {
  broadcast,
  cancelCohostGrace,
  type CommandResult,
  GRACE_MS,
  liveNotFound,
  notHost,
  type Presence,
  type RunningLive,
  toHost,
} from "./live-state.js";
import type { Participant, Role } from "./protocol/index.js";
import { MAX_COHOSTS } from "./stage.js";

const noJoinRequest = { ok: false, code: "not_found", message: "Aucune Demande de montée de ce Participant." } as const;

/** Montée à l'écran : Demandes de montée, Co-hôtes, leur Délai de grâce et leur permission de publier. */
export class StageCommands {
  constructor(private readonly ctx: LiveContext) {}

  /** Un Spectateur demande à monter à l'écran : `ack`, puis `joinRequested` chez l'Hôte (une seule fois). */
  requestToJoin(presence: Presence, accepted: () => void): CommandResult {
    if (presence.role !== "viewer") {
      return { ok: false, code: "invalid_command", message: "Seul un Spectateur peut demander à monter." };
    }
    const state = this.ctx.runningFor(presence);
    if (!state) return liveNotFound;
    const isNew = state.stage.request(presence.participant);
    accepted();
    if (isNew) toHost(state, { type: "joinRequested", participant: presence.participant });
    return { ok: true };
  }

  /** Le Spectateur annule sa Demande de montée : `ack`, puis `joinRequestCancelled` chez l'Hôte. */
  cancelJoinRequest(presence: Presence, accepted: () => void): CommandResult {
    const state = this.ctx.runningFor(presence);
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
    const { ctx } = this;
    if (presence.role !== "host") return notHost;
    const state = ctx.runningFor(presence);
    if (!state) return liveNotFound;
    const requester = state.stage.requestOf(participantId);
    if (!requester) return noJoinRequest;
    if (state.stage.isFull) {
      return { ok: false, code: "cohost_limit", message: `Déjà ${MAX_COHOSTS} Co-hôtes à l'écran.` };
    }
    // Place réservée en mémoire avant l'écriture : deux acceptations simultanées ne dépassent pas la limite.
    state.stage.promote(requester);
    try {
      await ctx.store.addCohost(state.live.id, requester, ctx.clock.now());
    } catch (error) {
      state.stage.undoPromote(requester, state.present.has(requester.id));
      throw error;
    }
    // Permission ouverte avant l'annonce : le Co-hôte peut publier dès qu'il reçoit `roleChanged`.
    await this.updateCanPublish(state, requester.id, true);
    if (!ctx.isRunning(state)) return liveNotFound;
    this.setRole(state, requester, "cohost");
    // Parti pendant l'acceptation : Co-hôte absent, son Délai de grâce court.
    if (!state.present.has(requester.id)) this.startCohostGrace(state, requester.id);
    accepted();
    broadcast(state, { type: "roleChanged", participant: requester, role: "cohost" });
    return { ok: true };
  }

  /** L'Hôte refuse une Demande de montée : elle disparaît, `ack`, puis `joinDeclined` chez le Spectateur. */
  declineJoin(presence: Presence, participantId: string, accepted: () => void): CommandResult {
    if (presence.role !== "host") return notHost;
    const state = this.ctx.runningFor(presence);
    if (!state) return liveNotFound;
    if (!state.stage.withdraw(participantId)) return noJoinRequest;
    accepted();
    state.present.get(participantId)?.connection.send({ type: "joinDeclined" });
    return { ok: true };
  }

  /** Le Co-hôte redescend de lui-même : `ack`, puis `roleChanged` vers Spectateur à tous. */
  async leaveStage(presence: Presence, accepted: () => void): Promise<CommandResult> {
    if (presence.role !== "cohost") {
      return { ok: false, code: "invalid_command", message: "Seul un Co-hôte peut redescendre." };
    }
    const state = this.ctx.runningFor(presence);
    if (!state) return liveNotFound;
    return this.demote(state, presence.participant.id, accepted);
  }

  /** L'Hôte retire un Co-hôte, même absent : `ack`, puis `roleChanged` vers Spectateur à tous. */
  async removeCohost(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    if (presence.role !== "host") return notHost;
    const state = this.ctx.runningFor(presence);
    if (!state) return liveNotFound;
    return this.demote(state, participantId, accepted);
  }

  /**
   * Fait redescendre un Co-hôte, même absent : `onDemoted`, puis `roleChanged` vers
   * Spectateur à tous, publication fermée. `not_found` s'il n'est pas (ou plus) Co-hôte.
   */
  async demote(state: RunningLive, participantId: string, onDemoted: () => void = () => {}): Promise<CommandResult> {
    const { ctx } = this;
    const removed = state.stage.demote(participantId);
    if (!removed) return { ok: false, code: "not_found", message: "Ce Participant n'est pas Co-hôte." };
    cancelCohostGrace(state, participantId);
    try {
      await ctx.store.removeCohost(state.live.id, participantId);
    } catch (error) {
      state.stage.undoDemote(removed);
      throw error;
    }
    // Le Live a pu se terminer pendant l'écriture : la descente est conservée, sans annonce.
    if (!ctx.isRunning(state)) return liveNotFound;
    this.setRole(state, removed.cohost, "viewer");
    onDemoted();
    broadcast(state, { type: "roleChanged", participant: removed.cohost, role: "viewer" });
    await this.updateCanPublish(state, participantId, false);
    return { ok: true };
  }

  /** Sans retour dans le Délai de grâce, ce Co-hôte redevient Spectateur. */
  startCohostGrace(state: RunningLive, participantId: string): void {
    const { ctx } = this;
    cancelCohostGrace(state, participantId);
    if (ctx.stopped) return;
    const timer = ctx.clock.setTimeout(() => {
      state.cohostGrace.delete(participantId);
      if (!ctx.isRunning(state)) return;
      this.demote(state, participantId).catch((error: unknown) => {
        const liveId = state.live.id;
        ctx.log.error({ err: error, liveId }, "retour d'un Co-hôte absent parmi les Spectateurs impossible");
      });
    }, GRACE_MS);
    state.cohostGrace.set(participantId, timer);
  }

  /** Change le rôle d'un Participant présent ; l'Audience suit (les Animateurs n'y comptent pas). */
  private setRole(state: RunningLive, participant: Participant, role: Role): void {
    const presence = state.present.get(participant.id);
    if (presence) presence.role = role;
    this.ctx.audienceChanged(state);
  }

  /**
   * Ouvre ou ferme la publication d'un Participant dans la room LiveKit. Un échec
   * (Participant pas encore connecté au média…) est journalisé : son prochain
   * `join` lui donne un jeton à jour.
   */
  private async updateCanPublish(state: RunningLive, participantId: string, canPublish: boolean): Promise<void> {
    try {
      await this.ctx.livekit.setCanPublish(state.live.id, participantId, canPublish);
    } catch (error) {
      this.ctx.log.error({ err: error, liveId: state.live.id }, "changement de la permission de publier impossible");
    }
  }
}
