import { ChatCommands } from "./live-chat.js";
import { LiveContext, type LivesDeps } from "./live-context.js";
import { type LiveAdminState, LiveLifecycle } from "./live-lifecycle.js";
import { ModerationCommands } from "./live-moderation.js";
import { ShopCommands } from "./live-shop.js";
import { StageCommands } from "./live-stage.js";
import type { CommandResult, Connection, JoinResult, Presence } from "./live-state.js";
import type { Live } from "./live-store.js";
import type { EndSummary, LiveSummary, Participant } from "./protocol/index.js";

export type { LivesDeps } from "./live-context.js";
export type { LiveAdminState } from "./live-lifecycle.js";
export {
  AUDIENCE_INTERVAL_MS,
  CHAT_LIMIT,
  CHAT_WINDOW_MS,
  type CommandResult,
  type Connection,
  GRACE_MS,
  type JoinResult,
  type Logger,
  type Presence,
  SNAPSHOT_MESSAGES,
} from "./live-state.js";

/**
 * Les Lives, vus du transport (HTTP et WebSocket) : une seule porte d'entrée, qui
 * délègue à ses modules. Cycle de vie et présence (`live-lifecycle`), chat et
 * Réactions (`live-chat`), montée à l'écran (`live-stage`), Produit épinglé et
 * Achats (`live-shop`), modération (`live-moderation`) ; `live-state` porte l'état
 * en mémoire et `live-context` ce qu'ils partagent.
 */
export class Lives {
  private readonly lifecycle: LiveLifecycle;
  private readonly chat: ChatCommands;
  private readonly shop: ShopCommands;
  private readonly stage: StageCommands;
  private readonly moderation: ModerationCommands;

  constructor(deps: LivesDeps) {
    const ctx = new LiveContext(deps);
    this.chat = new ChatCommands(ctx);
    this.shop = new ShopCommands(ctx, this.chat);
    this.stage = new StageCommands(ctx);
    this.moderation = new ModerationCommands(ctx, this.stage);
    this.lifecycle = new LiveLifecycle(ctx, this.stage);
  }

  // ---------------------------------------------------------------- cycle de vie

  launch(host: Participant, title: string | undefined): Promise<{ live: Live; created: boolean }> {
    return this.lifecycle.launch(host, title);
  }

  resume(): Promise<void> {
    return this.lifecycle.resume();
  }

  stop(): Promise<void> {
    return this.lifecycle.stop();
  }

  list(): Promise<LiveSummary[]> {
    return this.lifecycle.list();
  }

  adminState(): Promise<LiveAdminState[]> {
    return this.lifecycle.adminState();
  }

  summarize(live: Live): LiveSummary {
    return this.lifecycle.summarize(live);
  }

  summary(liveId: string, participant: Participant): Promise<EndSummary | undefined> {
    return this.lifecycle.summary(liveId, participant);
  }

  join(liveId: string, participant: Participant, connection: Connection): Promise<JoinResult> {
    return this.lifecycle.join(liveId, participant, connection);
  }

  leave(presence: Presence): void {
    this.lifecycle.leave(presence);
  }

  endLive(presence: Presence, accepted: () => void): Promise<CommandResult> {
    return this.lifecycle.endLive(presence, accepted);
  }

  // ---------------------------------------------------------------- chat et Réactions

  sendMessage(presence: Presence, text: string, accepted: () => void): Promise<CommandResult> {
    return this.chat.sendMessage(presence, text, accepted);
  }

  deleteMessage(presence: Presence, messageId: string, accepted: () => void): Promise<CommandResult> {
    return this.chat.deleteMessage(presence, messageId, accepted);
  }

  react(presence: Presence, emoji: string): void {
    this.chat.react(presence, emoji);
  }

  // ---------------------------------------------------------------- montée à l'écran

  requestToJoin(presence: Presence, accepted: () => void): CommandResult {
    return this.stage.requestToJoin(presence, accepted);
  }

  cancelJoinRequest(presence: Presence, accepted: () => void): CommandResult {
    return this.stage.cancelJoinRequest(presence, accepted);
  }

  acceptJoin(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    return this.stage.acceptJoin(presence, participantId, accepted);
  }

  declineJoin(presence: Presence, participantId: string, accepted: () => void): CommandResult {
    return this.stage.declineJoin(presence, participantId, accepted);
  }

  leaveStage(presence: Presence, accepted: () => void): Promise<CommandResult> {
    return this.stage.leaveStage(presence, accepted);
  }

  removeCohost(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    return this.stage.removeCohost(presence, participantId, accepted);
  }

  // ---------------------------------------------------------------- Produit épinglé et Achat

  pinProduct(presence: Presence, candidate: unknown, accepted: () => void): Promise<CommandResult> {
    return this.shop.pinProduct(presence, candidate, accepted);
  }

  unpinProduct(presence: Presence, accepted: () => void): Promise<CommandResult> {
    return this.shop.unpinProduct(presence, accepted);
  }

  purchase(presence: Presence, productId: string, accepted: () => void): Promise<CommandResult> {
    return this.shop.purchase(presence, productId, accepted);
  }

  // ---------------------------------------------------------------- modération

  shadowban(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    return this.moderation.shadowban(presence, participantId, accepted);
  }

  unshadowban(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    return this.moderation.unshadowban(presence, participantId, accepted);
  }

  ban(presence: Presence, participantId: string, accepted: () => void): Promise<CommandResult> {
    return this.moderation.ban(presence, participantId, accepted);
  }
}
