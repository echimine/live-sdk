import { afterEach, beforeEach, expect } from "vitest";
import { LivesCreateResponse, LivesListResponse, ServerMessage } from "../src/protocol/index.js";
import type { TestSocket } from "./fakes.js";
import { bearer, participantToken, resetDatabase, startLiveServer, type LiveServer } from "./support.js";

export type Claims = Parameters<typeof participantToken>[0];

/**
 * Serveur commun neuf pour chaque test (base vidée), avec les gestes d'un SDK :
 * lancer un Live, le rejoindre par WebSocket, lister les Lives. À appeler dans un `describe`.
 */
export function useLiveServer(options: Parameters<typeof startLiveServer>[0] = {}) {
  let live: LiveServer;
  const sockets: TestSocket[] = [];

  beforeEach(async () => {
    await resetDatabase();
    live = await startLiveServer(options);
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await live.server.close();
  });

  const harness = {
    get live() {
      return live;
    },

    async launch(claims: Claims, title?: string) {
      const response = await live.server.inject({
        method: "POST",
        url: "/v1/lives",
        headers: bearer(await participantToken(claims)),
        ...(title !== undefined && { payload: { title } }),
      });
      return LivesCreateResponse.parse(response.json()).live;
    },

    /** Ouvre un socket, envoie `join` et rend le socket avec le premier message reçu. */
    async join(liveId: string, claims: Claims) {
      const socket = await live.openSocket(liveId);
      sockets.push(socket);
      socket.send({ type: "join", token: await participantToken(claims) });
      const reply = ServerMessage.parse(await socket.next());
      return { socket, reply };
    },

    /** Coupe le serveur (sockets compris) et en démarre un neuf sur la même base, horloge remise à `now`. */
    async restart() {
      await live.server.close();
      live = await startLiveServer(options);
    },

    async listLives() {
      const response = await live.server.inject({
        method: "GET",
        url: "/v1/lives",
        headers: bearer(await participantToken({ sub: "curieux" })),
      });
      return LivesListResponse.parse(response.json()).lives;
    },

    /**
     * Aller-retour par une commande inconnue : tout ce que le client a envoyé avant
     * est traité, et rien d'autre n'arrive avant la réponse.
     */
    async sync(socket: TestSocket) {
      socket.send({ type: "pasUneCommande", ref: "sync" });
      expect(await socket.next()).toMatchObject({ type: "error", ref: "sync", code: "unknown_command" });
    },
  };
  return harness;
}
