import { afterEach, beforeEach, expect } from "vitest";
import { PING_INTERVAL_MS } from "../src/live-socket.js";
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
  /** Serveurs « plantés » : laissés de côté sans arrêt propre, fermés après le test. */
  const crashed: LiveServer[] = [];

  beforeEach(async () => {
    await resetDatabase();
    live = await startLiveServer(options);
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await live.server.close();
    for (const server of crashed.splice(0)) await server.server.close();
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

    /**
     * Redémarrage brutal : un serveur neuf prend le relais sur la même base sans que
     * l'ancien ait pu s'arrêter proprement (rien n'est écrit à l'arrêt). L'ancien,
     * dont l'horloge n'avance plus, n'est fermé qu'après le test.
     */
    async crash() {
      crashed.push(live);
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
    async sync(socket: TestSocket, { skipAudience = false } = {}) {
      socket.send({ type: "pasUneCommande", ref: "sync" });
      const message = skipAudience ? await harness.nextNotAudience(socket) : await socket.next();
      expect(message).toMatchObject({ type: "error", ref: "sync", code: "unknown_command" });
    },

    /** Prochain message hors diffusion d'Audience (qui part dès que l'horloge passe 2 s). */
    async nextNotAudience(socket: TestSocket) {
      let message = await socket.next();
      while (message.type === "audience") message = await socket.next();
      return message;
    },

    /**
     * Avance l'horloge par demi-intervalles de ping, avec un aller-retour entre deux
     * pas : les sockets répondent aux pings et restent ouverts, comme des clients
     * sains. Les diffusions d'Audience reçues entre-temps sont ignorées.
     */
    async elapse(ms: number, sockets: TestSocket[]) {
      for (let remaining = ms; remaining > 0; ) {
        const step = Math.min(PING_INTERVAL_MS / 2, remaining);
        live.clock.advance(step);
        remaining -= step;
        if (remaining > 0) for (const socket of sockets) await harness.sync(socket, { skipAudience: true });
      }
    },
  };
  return harness;
}
