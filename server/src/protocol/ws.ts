import { z } from "zod";
import { Currency, HttpsUrl, LiveTitle, Participant, Price, ProductName, Role, Timestamp } from "./common.js";

/*
 * Protocole WebSocket du Live (`/v1/lives/{id}/ws`) : enveloppe JSON discriminée
 * par `type`. Les commandes portent un `ref`, auquel le serveur répond par `ack`
 * ou `error` ; les événements n'en ont pas. Un champ optionnel absent est omis,
 * jamais `null`. Types et champs inconnus sont ignorés.
 */

const ParticipantId = z.string().min(1);
export const Ref = z.string().min(1).max(64);

function command<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ type: z.literal(type), ref: Ref, ...shape });
}

/** Message sans `ref` : les événements, ainsi que `join` et `react`. */
function message<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ type: z.literal(type), ...shape });
}

export const Product = z.object({
  id: z.string().min(1),
  name: ProductName,
  price: Price,
  currency: Currency,
  imageUrl: HttpsUrl.optional(),
});
export type Product = z.infer<typeof Product>;

/** Audience : Spectateurs connectés, Animateurs exclus, détaillée par App d'origine. */
const AudienceCounts = {
  total: z.int().min(0),
  byApp: z.record(z.string(), z.int().min(0)),
};

const ChatMessageBase = {
  id: z.string().min(1),
  author: Participant,
  /** Rôle de l'auteur au moment du message. */
  role: Role,
  at: Timestamp,
};

/**
 * Message du chat. Une Annonce d'achat (`kind: "purchase"`) porte le produit
 * acheté et non un texte : le SDK formate le prix selon la locale du téléphone.
 */
export const ChatMessage = z.discriminatedUnion("kind", [
  z.object({ ...ChatMessageBase, kind: z.literal("text"), text: z.string().min(1) }),
  z.object({
    ...ChatMessageBase,
    kind: z.literal("purchase"),
    product: Product.pick({ id: true, name: true, price: true, currency: true }),
  }),
]);
export type ChatMessage = z.infer<typeof ChatMessage>;

/** Listes visibles des seuls Animateurs. */
const Moderation = {
  shadowbanned: z.array(Participant),
  banned: z.array(Participant),
};

// ---------------------------------------------------------------- SDK → serveur

/** Premier message du socket, sous 5 s ; réponse : `snapshot` ou `error` sans `ref`. */
export const Join = message("join", { token: z.string().min(1) });

/** Réaction sans `ack` : un emoji hors du jeu ou au-delà de 10/s est ignoré en silence. */
export const React = message("react", { emoji: z.string().min(1) });

export const ClientMessage = z.discriminatedUnion("type", [
  Join,
  command("endLive", {}),
  command("requestToJoin", {}),
  command("cancelJoinRequest", {}),
  command("acceptJoin", { participantId: ParticipantId }),
  command("declineJoin", { participantId: ParticipantId }),
  command("leaveStage", {}),
  command("removeCohost", { participantId: ParticipantId }),
  React,
  /** Le serveur coupe les espaces et exige 1 à 300 caractères visibles (`invalid_message`). */
  command("sendMessage", { text: z.string() }),
  command("deleteMessage", { messageId: z.string().min(1) }),
  command("pinProduct", Product.omit({ id: true }).shape),
  command("unpinProduct", {}),
  /** `product_changed` si `productId` n'est plus le Produit épinglé. */
  command("purchase", { productId: z.string().min(1) }),
  command("shadowban", { participantId: ParticipantId }),
  command("unshadowban", { participantId: ParticipantId }),
  /** Un Co-hôte n'est bannissable que par l'Hôte. */
  command("ban", { participantId: ParticipantId }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------------------------------------------------------------- serveur → SDK

export const ErrorCode = z.enum([
  "invalid_token",
  "live_not_found",
  "banned",
  "not_host",
  "not_animator",
  "cohost_limit",
  "rate_limited",
  "product_changed",
  "invalid_message",
  "invalid_product",
  "invalid_command",
  "unknown_command",
  "not_found",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ServerMessage = z.discriminatedUnion("type", [
  message("ack", { ref: Ref }),
  message("error", {
    /** Absent quand l'erreur répond à `join` ou à un message illisible. */
    ref: Ref.optional(),
    code: ErrorCode,
    message: z.string(),
    /** Présent avec `rate_limited`, et seulement avec lui. */
    retryAfterMs: z.int().min(0).optional(),
  }).refine((error) => (error.code === "rate_limited") === (error.retryAfterMs !== undefined), {
    message: "retryAfterMs accompagne rate_limited, et seulement lui",
    path: ["retryAfterMs"],
  }),
  /** État complet, envoyé après chaque `join`. Pas de séquence ni de rejeu. */
  message("snapshot", {
    live: z.object({
      id: z.string().min(1),
      title: LiveTitle.optional(),
      startedAt: Timestamp,
    }),
    you: Participant,
    role: Role,
    host: Participant,
    /** `false` pendant le Délai de grâce de l'Hôte. */
    hostConnected: z.boolean(),
    /** Par ordre de montée. */
    cohosts: z.array(Participant).max(5),
    pinnedProduct: Product.optional(),
    audience: z.object(AudienceCounts),
    reactionsTotal: z.int().min(0),
    /** 50 derniers messages, Annonces d'achat comprises, filtrés par Shadowban. */
    messages: z.array(ChatMessage).max(50),
    livekit: z.object({
      url: z.url({ protocol: /^wss?$/ }),
      token: z.string().min(1),
    }),
    /** Demandes de montée en attente : pour l'Hôte seul. */
    joinRequests: z.array(Participant).optional(),
    /** Shadowbans et Bannissements : pour les Animateurs seuls. */
    moderation: z.object(Moderation).optional(),
  }),
  /** Un nouveau `join` du même Participant a remplacé ce socket. */
  message("replaced", {}),
  message("hostDisconnected", {}),
  message("hostReconnected", {}),
  /** La room est supprimée et les sockets fermés. */
  message("liveEnded", {
    reason: z.enum(["endedByHost", "hostTimeout"]),
    /** Récapitulatif de fin : pour l'Hôte seul. */
    summary: z
      .object({
        purchases: z.int().min(0),
        reactions: z.int().min(0),
        peakAudience: z.int().min(0),
      })
      .optional(),
  }),
  /** Vers l'Hôte seul. */
  message("joinRequested", { participant: Participant }),
  /** Vers l'Hôte seul. */
  message("joinRequestCancelled", { participantId: ParticipantId }),
  /** Vers le Spectateur dont l'Hôte a refusé la Demande de montée. */
  message("joinDeclined", {}),
  message("roleChanged", { participant: Participant, role: Role }),
  /** Au plus toutes les 2 s, seulement si l'Audience a changé. */
  message("audience", AudienceCounts),
  /** Toutes les 500 ms : `counts` sur la fenêtre, `total` depuis le début du Live. */
  message("reactions", {
    counts: z.record(z.string(), z.int().positive()),
    total: z.int().min(0),
  }),
  message("chatMessage", { message: ChatMessage }),
  message("messageDeleted", { messageId: z.string().min(1) }),
  message("productPinned", { product: Product }),
  message("productUnpinned", {}),
  /** Vers le Participant banni, juste avant la fermeture du socket. */
  message("banned", {}),
  /** Vers les Animateurs seuls : listes complètes à jour. */
  message("moderationChanged", Moderation),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
