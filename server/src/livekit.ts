import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

export interface LivekitTokenRequest {
  room: string;
  /** `Participant.id` : identité du Participant dans la room. */
  identity: string;
  name: string;
  canPublish: boolean;
}

/**
 * Port interne vers LiveKit, qui ne transporte que le média : le serveur commun
 * crée la room au lancement, la supprime à la fin, émet les jetons et change
 * `canPublish`. Remplacé par un faux en test.
 */
export interface LivekitPort {
  /** URL de signal à laquelle les SDK se connectent (`ws:` ou `wss:`). */
  readonly url: string;
  createRoom(room: string): Promise<void>;
  /** Sans effet si la room n'existe plus. */
  deleteRoom(room: string): Promise<void>;
  issueToken(request: LivekitTokenRequest): Promise<string>;
  setCanPublish(room: string, identity: string, canPublish: boolean): Promise<void>;
  /** Retire un Participant de la room (Bannissement) ; sans effet s'il n'y est pas. */
  removeParticipant(room: string, identity: string): Promise<void>;
}

/** Les jetons LiveKit ne servent qu'à la connexion ; chaque `join` en émet un nouveau. */
const TOKEN_TTL = "1h";
/** Une room vide (Hôte parti) reste ouverte ; le serveur commun décide de sa fin. */
const EMPTY_TIMEOUT_SECONDS = 24 * 60 * 60;

function withProtocol(url: string, http: boolean): string {
  const parsed = new URL(url);
  const secure = parsed.protocol === "https:" || parsed.protocol === "wss:";
  parsed.protocol = http ? (secure ? "https:" : "http:") : secure ? "wss:" : "ws:";
  return parsed.toString().replace(/\/$/, "");
}

export function createLivekitPort(options: { url: string; apiKey: string; apiSecret: string }): LivekitPort {
  const rooms = new RoomServiceClient(withProtocol(options.url, true), options.apiKey, options.apiSecret);
  // Les permissions sont fixées par le serveur commun ; aucune donnée ne passe par LiveKit (ADR 0002).
  const permission = (canPublish: boolean) => ({ canPublish, canSubscribe: true, canPublishData: false });

  return {
    url: withProtocol(options.url, false),
    async createRoom(room) {
      await rooms.createRoom({ name: room, emptyTimeout: EMPTY_TIMEOUT_SECONDS });
    },
    async deleteRoom(room) {
      try {
        await rooms.deleteRoom(room);
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
    },
    async issueToken({ room, identity, name, canPublish }) {
      const token = new AccessToken(options.apiKey, options.apiSecret, { identity, name, ttl: TOKEN_TTL });
      token.addGrant({ roomJoin: true, room, ...permission(canPublish) });
      return token.toJwt();
    },
    async setCanPublish(room, identity, canPublish) {
      await rooms.updateParticipant(room, identity, { permission: permission(canPublish) });
    },
    async removeParticipant(room, identity) {
      try {
        await rooms.removeParticipant(room, identity);
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
    },
  };
}
