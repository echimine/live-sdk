import type { RecentMessage } from "./chat-store.js";
import type { Timer } from "./clock.js";
import type { Live } from "./live-store.js";
import type { LiveModeration } from "./moderation.js";
import type { SlidingWindow } from "./rate-limit.js";
import type { LiveReactions } from "./reactions.js";
import type { LiveShop } from "./shop.js";
import type { LiveStage } from "./stage.js";
import type { ErrorCode, Participant, Role, ServerMessage } from "./protocol/index.js";

/*
 * État en mémoire d'un Live en cours, et tout ce que les modules du Live
 * (`live-lifecycle`, `live-chat`, `live-stage`, `live-shop`, `live-moderation`)
 * partagent : types, constantes, réponses d'erreur et helpers purs sur cet état.
 */

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

export type Audience = Omit<Extract<ServerMessage, { type: "audience" }>, "type">;

/** Journal des erreurs survenues hors d'une requête (minuteurs) et des avertissements. */
export interface Logger {
  error(details: object, message: string): void;
  warn(details: object, message: string): void;
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
export interface RunningLive {
  live: Live;
  /** Une seule présence par Participant : le dernier `join` remplace le précédent. */
  present: Map<string, Presence>;
  /** Audience maximale, écrite en base à chaque nouveau sommet (`peakSave` : écriture en cours). */
  peakAudience: number;
  peakSave: Promise<void> | undefined;
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
  recentMessages: RecentMessage[];
  /** Messages récents de chaque Participant, pour la limite du chat. */
  chatWindow: SlidingWindow;
  /** Réactions : agrégation, diffusion et total conservé. */
  reactions: LiveReactions;
  /** Co-hôtes et Demandes de montée. */
  stage: LiveStage;
  /** Délais de grâce des Co-hôtes déconnectés. */
  cohostGrace: Map<string, Timer>;
  /** Produit épinglé et Achats. */
  shop: LiveShop;
  /** Shadowbans et Bannissements. */
  moderation: LiveModeration;
}

export type JoinResult = { ok: true; presence: Presence } | { ok: false; code: ErrorCode; message: string };
export type CommandResult =
  | { ok: true }
  | { ok: false; code: Exclude<ErrorCode, "rate_limited">; message: string }
  | { ok: false; code: "rate_limited"; message: string; retryAfterMs: number };
export type CommandFailure = Extract<CommandResult, { ok: false }>;

export const liveNotFound = { ok: false, code: "live_not_found", message: "Ce Live n'existe pas ou est terminé." } as const;
export const notHost = { ok: false, code: "not_host", message: "Seul l'Hôte peut faire cela." } as const;
export const bannedFromLive = { ok: false, code: "banned", message: "Vous êtes banni de ce Live." } as const;
export const notAnimatorForModeration = {
  ok: false,
  code: "not_animator",
  message: "Seuls les Animateurs peuvent modérer.",
} as const;

/** Identifiant, titre éventuel et début d'un Live, tels qu'ils partent sur le fil. */
export function liveHeader(live: Live): { id: string; title?: string; startedAt: string } {
  return { id: live.id, ...(live.title !== undefined && { title: live.title }), startedAt: live.startedAt.toISOString() };
}

/** Envoie un message à tous les Participants présents, sauf `except`. */
export function broadcast(state: RunningLive, message: ServerMessage, except?: Presence): void {
  for (const presence of state.present.values()) {
    if (presence !== except) presence.connection.send(message);
  }
}

/** Envoie un message à l'Hôte, s'il est connecté. */
export function toHost(state: RunningLive, message: ServerMessage): void {
  state.present.get(state.live.host.id)?.connection.send(message);
}

/** Envoie les listes de modération à jour aux Animateurs connectés. */
export function moderationChanged(state: RunningLive): void {
  const message: ServerMessage = { type: "moderationChanged", ...state.moderation.lists };
  for (const presence of state.present.values()) {
    if (presence.role !== "viewer") presence.connection.send(message);
  }
}

/** Rôle d'un Participant dans ce Live : décidé par le serveur seul. */
export function roleOf(state: RunningLive, participantId: string): Role {
  if (participantId === state.live.host.id) return "host";
  return state.stage.isCohost(participantId) ? "cohost" : "viewer";
}

export function cancelCohostGrace(state: RunningLive, participantId: string): void {
  state.cohostGrace.get(participantId)?.cancel();
  state.cohostGrace.delete(participantId);
}

export function cancelAllCohostGrace(state: RunningLive): void {
  for (const timer of state.cohostGrace.values()) timer.cancel();
  state.cohostGrace.clear();
}

/** Ce Participant tel que le Live le connaît : présent, à l'écran, en demande, modéré ou auteur récent. */
export function knownParticipant(state: RunningLive, participantId: string): Participant | undefined {
  const { moderation, stage } = state;
  return (
    state.present.get(participantId)?.participant ??
    stage.cohosts.find((p) => p.id === participantId) ??
    stage.requestOf(participantId) ??
    [...moderation.lists.shadowbanned, ...moderation.lists.banned].find((p) => p.id === participantId) ??
    state.recentMessages.findLast(({ message }) => message.author.id === participantId)?.message.author
  );
}

/** Audience : Spectateurs connectés, Animateurs exclus, détaillée par App d'origine. */
export function audienceOf(state: RunningLive): Audience {
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
export function sameAudience(a: Audience, b: Audience): boolean {
  const apps = Object.keys(a.byApp);
  return a.total === b.total && apps.length === Object.keys(b.byApp).length && apps.every((app) => a.byApp[app] === b.byApp[app]);
}
