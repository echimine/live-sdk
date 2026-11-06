import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { Clock, Timer } from "./clock.js";
import type { CommandResult, Connection, Lives, Presence } from "./lives.js";
import type { MemberApps } from "./member-apps.js";
import { InvalidParticipantToken, verifyParticipantToken } from "./participant-token.js";
import { Quota } from "./rate-limit.js";
import { ClientMessage, type ErrorCode, Join, Ref, type ServerMessage } from "./protocol/index.js";

/** Le premier message, `join`, doit aboutir dans ce délai. */
export const JOIN_TIMEOUT_MS = 5_000;
/** Cadence du ping ; sans pong avant le ping suivant, le socket est coupé. */
export const PING_INTERVAL_MS = 20_000;

/** Au-delà, une trame ferme le socket en 1008. */
export const MAX_FRAME_BYTES = 16 * 1024;
/** Au-delà de ce nombre de trames par seconde, le socket est fermé en 1008. */
export const MAX_FRAMES_PER_SECOND = 50;
/**
 * Plafond dur de `ws`, qui ferme lui-même en 1009 : il borne seulement la
 * mémoire tamponnée ; la limite du protocole (16 Ko → 1008) est vérifiée à la réception.
 */
const WS_MAX_PAYLOAD_BYTES = 1024 * 1024;

/** Codes de fermeture du WebSocket du Live. */
const CloseCode = {
  /** Fin normale : Live terminé, socket remplacé. */
  normal: 1000,
  /** `join` absent, illisible ou refusé ; trame trop grosse ou trop fréquente. */
  policy: 1008,
  /** Erreur inattendue du serveur. */
  internal: 1011,
} as const;

const LIVE_SOCKET_PATH = /^\/v1\/lives\/([^/?#]+)\/ws(?:\?.*)?$/;

/** Types de messages connus du protocole, pour distinguer commande invalide et commande inconnue. */
const knownTypes = new Set<string>(ClientMessage.options.map((option) => option.shape.type.value));

export interface LiveSocketOptions {
  lives: Lives;
  memberApps: MemberApps;
  clock: Clock;
  /** Proxys de confiance devant le serveur, comme `TRUST_PROXY`. */
  trustProxy: number;
}

/** Quotas partagés par tous les sockets, au-delà de la vie d'un socket. */
interface Limits {
  /** `join` : 10/min par Participant. */
  joinByParticipant: Quota;
  /** `join` illisible ou au jeton refusé : 30/min par IP. Un jeton valide n'est jamais compté ni bloqué. */
  invalidJoinByIp: Quota;
  /** Commandes hors chat et Réactions, qui ont leurs propres limites : 10/10 s par Participant. */
  commandsByParticipant: Quota;
}

/** Messages qui ne consomment pas le quota des commandes. */
const ownLimitTypes = new Set(["join", "react", "sendMessage", "purchase"]);

interface Deps extends Omit<LiveSocketOptions, "trustProxy"> {
  log: FastifyBaseLogger;
  limits: Limits;
  /** IP du client, pour les quotas par IP. */
  ip: string;
}

/**
 * IP du client : le socket, ou en remontant `X-Forwarded-For` d'autant de relais
 * qu'il y a de proxys de confiance (même règle que Fastify).
 */
function clientIp(request: IncomingMessage, trustProxy: number): string {
  const socketAddress = request.socket.remoteAddress ?? "";
  if (trustProxy === 0) return socketAddress;
  const header = request.headers["x-forwarded-for"];
  const forwarded = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address !== "")
    .reverse();
  const chain = [socketAddress, ...forwarded];
  return chain[Math.min(trustProxy, chain.length - 1)] ?? socketAddress;
}

function liveIdOf(url: string | undefined): string | undefined {
  const match = LIVE_SOCKET_PATH.exec(url ?? "");
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * Branche le WebSocket du Live (`/v1/lives/{id}/ws`) sur le serveur HTTP de
 * Fastify. Toute autre demande de passage en WebSocket est refusée.
 */
export function attachLiveSockets(server: FastifyInstance, options: LiveSocketOptions): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });
  const { trustProxy, ...shared } = options;
  const limits: Limits = {
    joinByParticipant: new Quota(10, 60_000, options.clock),
    invalidJoinByIp: new Quota(30, 60_000, options.clock),
    commandsByParticipant: new Quota(10, 10_000, options.clock),
  };

  server.server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const liveId = liveIdOf(request.url);
    if (liveId === undefined) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const deps: Deps = { ...shared, limits, log: server.log, ip: clientIp(request, trustProxy) };
    wss.handleUpgrade(request, socket, head, (ws) => new LiveSocket(ws, liveId, deps));
  });

  // Avant que Fastify n'attende la fin des connexions HTTP : un socket encore
  // ouvert bloquerait sinon l'arrêt (redéploiement en plein Live).
  server.addHook("preClose", async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise((resolve) => wss.close(resolve));
  });
}

/** Un socket du Live : attend `join`, puis relaie les commandes vers `Lives`. */
class LiveSocket implements Connection {
  private presence: Presence | undefined;
  private joining = false;
  private readonly joinTimer: Timer;
  private pingTimer: Timer | undefined;
  private alive = true;
  /** Trames reçues : `MAX_FRAMES_PER_SECOND` par seconde au plus. */
  private readonly frames: Quota;

  constructor(
    private readonly ws: WebSocket,
    private readonly liveId: string,
    private readonly deps: Deps,
  ) {
    this.frames = new Quota(MAX_FRAMES_PER_SECOND, 1_000, deps.clock);
    this.joinTimer = deps.clock.setTimeout(() => this.ws.close(CloseCode.policy), JOIN_TIMEOUT_MS);
    this.schedulePing();
    ws.on("pong", () => (this.alive = true));
    ws.on("message", (data, isBinary) => {
      if (this.ws.readyState !== WebSocket.OPEN) return;
      if (byteLength(data) > MAX_FRAME_BYTES) return this.closeAbusive("trame trop grosse");
      if (this.frames.take("") !== undefined) return this.closeAbusive("trop de trames");
      this.receive(data, isBinary).catch((error: unknown) => {
        deps.log.error({ err: error, liveId }, "erreur inattendue sur le WebSocket du Live");
        this.ws.close(CloseCode.internal);
      });
    });
    ws.on("close", () => this.dispose());
    ws.on("error", () => ws.terminate());
  }

  send(message: ServerMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  end(): void {
    this.ws.close(CloseCode.normal);
  }

  /** Socket abusif : fermé en 1008, sans message, et noté dans les logs. */
  private closeAbusive(reason: string) {
    this.deps.log.warn(
      { liveId: this.liveId, participantId: this.presence?.participant.id, ip: this.deps.ip, reason },
      "WebSocket du Live fermé pour abus",
    );
    this.ws.close(CloseCode.policy);
  }

  private schedulePing() {
    this.pingTimer = this.deps.clock.setTimeout(() => {
      if (!this.alive) {
        this.ws.terminate();
        return;
      }
      this.alive = false;
      this.ws.ping();
      this.schedulePing();
    }, PING_INTERVAL_MS);
  }

  private dispose() {
    this.joinTimer.cancel();
    this.pingTimer?.cancel();
    if (this.presence) this.deps.lives.leave(this.presence);
  }

  private async receive(data: RawData, isBinary: boolean) {
    let raw: unknown;
    try {
      if (isBinary) throw new Error("trame binaire");
      raw = JSON.parse(data.toString());
    } catch {
      raw = undefined;
    }

    if (this.presence !== undefined) return this.command(raw, this.presence);
    if (!this.joining) return this.join(raw);
    // `join` en cours de vérification : une commande reçue entre-temps est refusée.
    const ref = refOf(raw);
    if (ref !== undefined) this.reject(ref, "invalid_command", "Commande reçue avant la fin du `join`.");
  }

  private async join(raw: unknown) {
    this.joining = true;
    const join = Join.safeParse(raw);
    if (!join.success) {
      return this.refuseInvalidJoin("invalid_command", "Le premier message doit être `join`.");
    }
    let participant;
    try {
      participant = await verifyParticipantToken(join.data.token, this.deps.memberApps, this.deps.clock.now());
    } catch (error) {
      if (!(error instanceof InvalidParticipantToken)) throw error;
      return this.refuseInvalidJoin("invalid_token", "Jeton de Participant refusé.");
    }
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const retryAfterMs = this.deps.limits.joinByParticipant.take(participant.id);
    if (retryAfterMs !== undefined) {
      return this.refuseJoin("rate_limited", "Trop de `join`, réessayez plus tard.", retryAfterMs);
    }

    const result = await this.deps.lives.join(this.liveId, participant, this);
    if (!result.ok) return this.refuseJoin(result.code, result.message);
    // Fermé pendant le `join` (délai dépassé, client parti) : il quitte aussitôt le Live.
    if (this.ws.readyState !== WebSocket.OPEN) return this.deps.lives.leave(result.presence);
    this.joinTimer.cancel();
    this.presence = result.presence;
  }

  /** `join` illisible ou au jeton refusé : compté par IP, `rate_limited` au-delà du quota. */
  private refuseInvalidJoin(code: ErrorCode, message: string) {
    const retryAfterMs = this.deps.limits.invalidJoinByIp.take(this.deps.ip);
    if (retryAfterMs !== undefined) {
      return this.refuseJoin("rate_limited", "Trop de `join` refusés, réessayez plus tard.", retryAfterMs);
    }
    this.refuseJoin(code, message);
  }

  private refuseJoin(code: ErrorCode, message: string, retryAfterMs?: number) {
    this.send({ type: "error", code, message, ...(retryAfterMs !== undefined && { retryAfterMs }) });
    this.ws.close(CloseCode.policy);
  }

  private async command(raw: unknown, presence: Presence) {
    const ref = refOf(raw);
    const type = (raw as { type?: unknown } | null | undefined)?.type;
    // Toute commande compte, même sans `ref` valide ; seule une commande avec `ref` reçoit la réponse.
    if (!(typeof type === "string" && ownLimitTypes.has(type))) {
      const retryAfterMs = this.deps.limits.commandsByParticipant.take(presence.participant.id);
      if (retryAfterMs !== undefined) {
        if (ref === undefined) return;
        return this.send({
          type: "error",
          ref,
          code: "rate_limited",
          message: "Trop de commandes, réessayez plus tard.",
          retryAfterMs,
        });
      }
    }

    const { lives } = this.deps;
    const parsed = ClientMessage.safeParse(raw);
    if (!parsed.success) {
      // Produit invalide : `invalid_product` (ou `not_animator`), décidé par le Live.
      if (type === "pinProduct" && ref !== undefined) {
        return this.run(ref, (accepted) => lives.pinProduct(presence, raw, accepted));
      }
      // Type inconnu sans `ref` : ignoré, comme le veut le protocole.
      if (typeof type !== "string" || !knownTypes.has(type)) {
        return ref === undefined ? undefined : this.reject(ref, "unknown_command", "Commande inconnue.");
      }
      return this.reject(ref, "invalid_command", "Commande invalide.");
    }

    const message = parsed.data;
    switch (message.type) {
      case "join":
        return;
      case "react":
        return lives.react(presence, message.emoji);
      case "endLive":
        return this.run(message.ref, (accepted) => lives.endLive(presence, accepted));
      case "sendMessage":
        return this.run(message.ref, (accepted) => lives.sendMessage(presence, message.text, accepted));
      case "deleteMessage":
        return this.run(message.ref, (accepted) => lives.deleteMessage(presence, message.messageId, accepted));
      case "requestToJoin":
        return this.run(message.ref, (accepted) => lives.requestToJoin(presence, accepted));
      case "cancelJoinRequest":
        return this.run(message.ref, (accepted) => lives.cancelJoinRequest(presence, accepted));
      case "acceptJoin":
        return this.run(message.ref, (accepted) => lives.acceptJoin(presence, message.participantId, accepted));
      case "declineJoin":
        return this.run(message.ref, (accepted) => lives.declineJoin(presence, message.participantId, accepted));
      case "leaveStage":
        return this.run(message.ref, (accepted) => lives.leaveStage(presence, accepted));
      case "removeCohost":
        return this.run(message.ref, (accepted) => lives.removeCohost(presence, message.participantId, accepted));
      case "pinProduct":
        return this.run(message.ref, (accepted) => lives.pinProduct(presence, message, accepted));
      case "unpinProduct":
        return this.run(message.ref, (accepted) => lives.unpinProduct(presence, accepted));
      case "purchase":
        return this.run(message.ref, (accepted) => lives.purchase(presence, message.productId, accepted));
      default:
        return this.reject(message.ref, "unknown_command", "Commande pas encore prise en charge.");
    }
  }

  /**
   * Exécute une commande du Live : `ack` quand le Live l'accepte (avant ses
   * diffusions), sinon `error` avec son code (et `retryAfterMs` pour `rate_limited`).
   */
  private async run(ref: string, command: (accepted: () => void) => CommandResult | Promise<CommandResult>) {
    const result = await command(() => this.send({ type: "ack", ref }));
    if (result.ok) return;
    const { ok: _ok, ...error } = result;
    this.send({ type: "error", ref, ...error });
  }

  private reject(ref: string | undefined, code: ErrorCode, message: string) {
    this.send({ type: "error", ...(ref !== undefined && { ref }), code, message });
  }
}

function byteLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.byteLength, 0);
  return data.byteLength;
}

function refOf(raw: unknown): string | undefined {
  const ref = Ref.safeParse((raw as { ref?: unknown } | null | undefined)?.ref);
  return ref.success ? ref.data : undefined;
}
