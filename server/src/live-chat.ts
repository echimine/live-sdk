import { newMessageId } from "./chat.js";
import type { RecentMessage } from "./chat-store.js";
import type { LiveContext } from "./live-context.js";
import {
  broadcast,
  CHAT_LIMIT,
  CHAT_WINDOW_MS,
  type CommandResult,
  liveNotFound,
  type Presence,
  type RunningLive,
  SNAPSHOT_MESSAGES,
} from "./live-state.js";
import { type ChatMessage, visibleText } from "./protocol/index.js";

/** Chat et Réactions d'un Live en cours : envoi, suppression, derniers messages du `snapshot`. */
export class ChatCommands {
  constructor(private readonly ctx: LiveContext) {}

  /** Un Participant écrit dans le chat : `ack` (via `accepted`), puis `chatMessage` à tous, auteur compris. */
  async sendMessage(presence: Presence, text: string, accepted: () => void): Promise<CommandResult> {
    const { ctx } = this;
    const state = ctx.runningFor(presence);
    if (!state) return liveNotFound;
    const visible = visibleText(text, ctx.config.chat.maxLength);
    if (visible === undefined) {
      const max = ctx.config.chat.maxLength;
      return { ok: false, code: "invalid_message", message: `Message vide ou de plus de ${max} caractères.` };
    }
    const author = presence.participant.id;
    const sentAt = ctx.clock.now();
    const retryAfterMs = state.chatWindow.take(author, CHAT_LIMIT[presence.role], sentAt);
    if (retryAfterMs !== undefined) {
      const limit = CHAT_LIMIT[presence.role];
      const seconds = CHAT_WINDOW_MS / 1000;
      return { ok: false, code: "rate_limited", message: `Doucement… (${limit} messages par ${seconds} s)`, retryAfterMs };
    }
    const hidden = state.moderation.isShadowbanned(author);
    const message = {
      id: newMessageId(),
      kind: "text",
      author: presence.participant,
      role: presence.role,
      text: visible,
      at: sentAt.toISOString(),
    } satisfies ChatMessage;
    try {
      await ctx.chat.insert(state.live.id, message, hidden);
    } catch (error) {
      // Message perdu : il ne compte pas dans la limite.
      state.chatWindow.giveBack(author, sentAt);
      throw error;
    }
    // Le Live a pu se terminer pendant l'écriture : le message est conservé, sans diffusion.
    if (!ctx.isRunning(state)) return liveNotFound;
    this.announce(state, { message, hidden }, accepted);
    return { ok: true };
  }

  /**
   * `onAccepted`, puis le message rejoint les derniers messages et part dans le
   * chat de tous ; envoyé en Shadowban, il ne part que chez son auteur.
   */
  announce(state: RunningLive, recent: RecentMessage, onAccepted: () => void): void {
    state.recentMessages = [...state.recentMessages, recent].slice(-SNAPSHOT_MESSAGES);
    onAccepted();
    const chatMessage = { type: "chatMessage", message: recent.message } as const;
    if (recent.hidden) state.present.get(recent.message.author.id)?.connection.send(chatMessage);
    else broadcast(state, chatMessage);
  }

  /**
   * Un Animateur supprime un message : suppression marquée, `ack` (via `accepted`),
   * puis `messageDeleted` à tous. Le message sort des `snapshot` suivants.
   */
  async deleteMessage(presence: Presence, messageId: string, accepted: () => void): Promise<CommandResult> {
    const { ctx } = this;
    if (presence.role === "viewer") {
      return { ok: false, code: "not_animator", message: "Seuls les Animateurs peuvent supprimer un message." };
    }
    const state = ctx.runningFor(presence);
    if (!state) return liveNotFound;
    if (!(await ctx.chat.markDeleted(state.live.id, messageId, ctx.clock.now()))) {
      return { ok: false, code: "not_found", message: "Message introuvable." };
    }
    state.recentMessages = state.recentMessages.filter((recent) => recent.message.id !== messageId);
    // Complété avant l'annonce : qui rejoint après `messageDeleted` reçoit bien 50 messages.
    // La suppression est faite : un échec du complément ne la remet pas en cause.
    await this.refillRecentMessages(state).catch((error: unknown) => {
      ctx.log.error({ err: error, liveId: state.live.id }, "relecture des derniers messages impossible");
    });
    // Le Live a pu se terminer pendant les écritures : la suppression est conservée, sans diffusion.
    if (!ctx.isRunning(state)) return liveNotFound;
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
    const stored = await this.ctx.chat.recent(state.live.id, SNAPSHOT_MESSAGES);
    const current = state.recentMessages;
    const oldestKept = current[0];
    const olderCount =
      oldestKept === undefined ? stored.length : stored.findIndex((m) => m.message.id === oldestKept.message.id);
    // Le plus ancien gardé n'est plus en base (supprimé pendant la lecture) : on laisse la mémoire telle quelle.
    if (olderCount <= 0) return;
    state.recentMessages = [...stored.slice(0, olderCount), ...current].slice(-SNAPSHOT_MESSAGES);
  }

  /** Un Participant envoie une Réaction : sans `ack`, diffusée à tous avec les autres (voir `LiveReactions`). */
  react(presence: Presence, emoji: string): void {
    const state = this.ctx.running.get(presence.liveId);
    // En Shadowban, les Réactions sont ignorées en silence.
    if (!state || state.ending || state.moderation.isShadowbanned(presence.participant.id)) return;
    state.reactions.add(presence.participant.id, emoji);
  }
}
