import type { LiveContext } from "./live-context.js";
import type { StageCommands } from "./live-stage.js";
import {
  type CommandFailure,
  type CommandResult,
  knownParticipant,
  liveNotFound,
  moderationChanged,
  notAnimatorForModeration,
  type Presence,
  type RunningLive,
  toHost,
} from "./live-state.js";
import type { Participant } from "./protocol/index.js";

/** Modération d'un Live en cours : Shadowbans et Bannissements, par les Animateurs. */
export class ModerationCommands {
  constructor(
    private readonly ctx: LiveContext,
    private readonly stage: StageCommands,
  ) {}

  /**
   * Un Animateur met un Participant en Shadowban : enregistré, `ack`, puis
   * `moderationChanged` aux Animateurs. Sans effet s'il y est déjà ou est banni.
   */
  async shadowban(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    const { ctx } = this;
    const state = ctx.runningFor(presence);
    if (!state) return liveNotFound;
    const target = moderationTarget(state, presence, participantId);
    if (!target.ok) return target;
    // Retenu en mémoire avant l'écriture, comme une montée : les droits vérifiés restent valables.
    const changed = state.moderation.shadowban(target.participant);
    if (changed) {
      try {
        await ctx.moderation.shadowban(state.live.id, target.participant, ctx.clock.now());
      } catch (error) {
        state.moderation.unshadowban(participantId);
        throw error;
      }
      if (!ctx.isRunning(state)) return liveNotFound;
    }
    accepted();
    if (changed) moderationChanged(state);
    return { ok: true };
  }

  /**
   * Un Animateur lève un Shadowban : `ack`, puis `moderationChanged` aux Animateurs
   * s'il y en avait un. Mêmes règles que `shadowban` : un Co-hôte n'agit pas sur un Co-hôte.
   */
  async unshadowban(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    const { ctx } = this;
    const state = ctx.runningFor(presence);
    if (!state) return liveNotFound;
    const target = moderationTarget(state, presence, participantId);
    if (!target.ok) return target;
    const lifted = state.moderation.unshadowban(participantId);
    if (lifted) {
      try {
        await ctx.moderation.unshadowban(state.live.id, participantId);
      } catch (error) {
        state.moderation.shadowban(lifted);
        throw error;
      }
      if (!ctx.isRunning(state)) return liveNotFound;
    }
    accepted();
    if (lifted) moderationChanged(state);
    return { ok: true };
  }

  /**
   * Un Animateur bannit un Participant de ce Live : enregistré, `ack`, puis le banni
   * reçoit `banned` et son socket se ferme ; un Co-hôte redescend ensuite parmi les
   * Spectateurs. Enfin `moderationChanged` aux Animateurs. Ses messages restent.
   */
  async ban(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    const { ctx } = this;
    const state = ctx.runningFor(presence);
    if (!state) return liveNotFound;
    const target = moderationTarget(state, presence, participantId);
    if (!target.ok) return target;
    // Retenu en mémoire avant l'écriture : un `join` en cours est refusé, et les droits vérifiés restent valables.
    const banned = state.moderation.ban(target.participant);
    if (!banned) {
      accepted();
      return { ok: true };
    }
    try {
      await ctx.moderation.ban(state.live.id, target.participant, ctx.clock.now());
    } catch (error) {
      state.moderation.undoBan(target.participant, banned);
      throw error;
    }
    if (!ctx.isRunning(state)) return liveNotFound;
    accepted();
    this.exclude(state, participantId);
    if (state.stage.withdraw(participantId)) toHost(state, { type: "joinRequestCancelled", participantId });
    if (state.stage.isCohost(participantId)) {
      // Déjà exclu : un échec de la descente ne le garde pas dans le Live, il est seulement journalisé.
      await this.stage.demote(state, participantId).catch((error: unknown) => {
        ctx.log.error({ err: error, liveId: state.live.id }, "descente d'un Co-hôte banni impossible");
      });
    }
    moderationChanged(state);
    return { ok: true };
  }

  /** Exclut un Participant banni : `banned`, socket fermé, retiré de la room LiveKit. */
  private exclude(state: RunningLive, participantId: string): void {
    const { ctx } = this;
    const presence = state.present.get(participantId);
    if (presence) {
      // Retiré avant la fermeture : son départ ne lance ni Délai de grâce ni diffusion.
      state.present.delete(participantId);
      presence.connection.send({ type: "banned" });
      presence.connection.end();
      ctx.audienceChanged(state);
    }
    ctx.livekit.removeParticipant(state.live.id, participantId).catch((error: unknown) => {
      ctx.log.error({ err: error, liveId: state.live.id }, "retrait d'un Participant banni de la room impossible");
    });
  }
}

/**
 * Le Participant visé par une modération, s'il peut l'être par cet Animateur :
 * jamais l'Hôte, un Co-hôte par l'Hôte seul (`not_animator`). `not_found` s'il
 * est inconnu de ce Live (ni présent, ni à l'écran, ni dans le chat récent).
 */
function moderationTarget(
  state: RunningLive,
  presence: Presence,
  participantId: string,
): { ok: true; participant: Participant } | CommandFailure {
  if (presence.role === "viewer") return notAnimatorForModeration;
  if (participantId === state.live.host.id) {
    return { ok: false, code: "not_animator", message: "L'Hôte ne peut pas être modéré." };
  }
  if (state.stage.isCohost(participantId) && presence.role !== "host") {
    return { ok: false, code: "not_animator", message: "Seul l'Hôte peut modérer un Co-hôte." };
  }
  const participant = knownParticipant(state, participantId);
  if (!participant) return { ok: false, code: "not_found", message: "Participant introuvable dans ce Live." };
  return { ok: true, participant };
}
