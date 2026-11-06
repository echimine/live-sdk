import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PING_INTERVAL_MS } from "../src/live-socket.js";
import { LivesCreateResponse, LivesListResponse, ServerMessage } from "../src/protocol/index.js";
import type { TestSocket } from "./fakes.js";
import { bearer, now, participantToken, resetDatabase, startLiveServer, type LiveServer } from "./support.js";

type Claims = Parameters<typeof participantToken>[0];

const lea: Claims = { sub: "u_1042", name: "Léa", picture: "https://cdn.example/lea.jpg" };
const noa: Claims = { iss: "demo-android", sub: "u_88", name: "Noa" };
const sam: Claims = { sub: "u_310", name: "Sam" };

describe("rejoindre et terminer un Live par WebSocket", () => {
  let live: LiveServer;
  const sockets: TestSocket[] = [];

  beforeEach(async () => {
    await resetDatabase();
    live = await startLiveServer();
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await live.server.close();
  });

  async function launch(claims: Claims, title?: string) {
    const response = await live.server.inject({
      method: "POST",
      url: "/v1/lives",
      headers: bearer(await participantToken(claims)),
      ...(title !== undefined && { payload: { title } }),
    });
    return LivesCreateResponse.parse(response.json()).live;
  }

  async function open(liveId: string, options?: { autoPong?: boolean }) {
    const socket = await live.openSocket(liveId, options);
    sockets.push(socket);
    return socket;
  }

  /** Ouvre un socket, envoie `join` et rend le socket avec le premier message reçu. */
  async function join(liveId: string, claims: Claims, options?: { autoPong?: boolean }) {
    const socket = await open(liveId, options);
    socket.send({ type: "join", token: await participantToken(claims) });
    const reply = ServerMessage.parse(await socket.next());
    return { socket, reply };
  }

  /**
   * Aller-retour par une commande inconnue : tout ce que le client a envoyé avant
   * (pong compris) est traité par le serveur. Les diffusions d'Audience reçues
   * entre-temps sont ignorées, sauf avec `strict`, où rien ne doit précéder la réponse.
   */
  async function sync(socket: TestSocket, { strict = false } = {}) {
    socket.send({ type: "pasUneCommande", ref: "sync" });
    let message = await socket.next();
    while (!strict && message.type === "audience") message = await socket.next();
    expect(message).toMatchObject({ type: "error", ref: "sync", code: "unknown_command" });
  }

  /**
   * Avance l'horloge par demi-intervalles de ping, avec un aller-retour entre deux
   * pas : les sockets répondent aux pings et restent ouverts, comme des clients sains.
   */
  async function elapse(ms: number, sockets: TestSocket[]) {
    for (let remaining = ms; remaining > 0; ) {
      const step = Math.min(PING_INTERVAL_MS / 2, remaining);
      live.clock.advance(step);
      remaining -= step;
      if (remaining > 0) for (const socket of sockets) await sync(socket);
    }
  }

  async function listLives() {
    const response = await live.server.inject({
      method: "GET",
      url: "/v1/lives",
      headers: bearer(await participantToken({ sub: "curieux" })),
    });
    return LivesListResponse.parse(response.json()).lives;
  }

  it("un Spectateur rejoint et reçoit le snapshot du Live", async () => {
    const created = await launch(lea, "Baskets");

    const { reply } = await join(created.id, noa);

    expect(reply).toEqual({
      type: "snapshot",
      live: { id: created.id, title: "Baskets", startedAt: now.toISOString() },
      you: { id: "demo-android:u_88", app: "demo-android", name: "Noa" },
      role: "viewer",
      host: { id: "demo-ios:u_1042", app: "demo-ios", name: "Léa", picture: "https://cdn.example/lea.jpg" },
      hostConnected: false,
      cohosts: [],
      audience: { total: 1, byApp: { "demo-android": 1 } },
      reactionsTotal: 0,
      messages: [],
      livekit: { url: "wss://livekit.test", token: "livekit-token-demo-android:u_88" },
    });
    expect(live.livekit.calls).toContainEqual(
      expect.objectContaining({ op: "issueToken", identity: "demo-android:u_88", canPublish: false }),
    );
  });

  it("l'Hôte rejoint son Live : il peut publier et voit les listes réservées aux Animateurs", async () => {
    const created = await launch(lea);

    const { reply } = await join(created.id, lea);

    expect(reply).toMatchObject({
      role: "host",
      hostConnected: true,
      audience: { total: 0, byApp: {} },
      joinRequests: [],
      moderation: { shadowbanned: [], banned: [] },
    });
    expect(live.livekit.calls).toContainEqual(
      expect.objectContaining({ op: "issueToken", identity: "demo-ios:u_1042", canPublish: true }),
    );
  });

  it("la liste est triée par Audience décroissante, Hôte exclu", async () => {
    const small = await launch(lea);
    const big = await launch(noa);
    await join(small.id, { sub: "v1" });
    for (const sub of ["v2", "v3"]) await join(big.id, { sub });
    await join(big.id, noa);

    expect((await listLives()).map((l) => [l.id, l.audience])).toEqual([
      [big.id, 2],
      [small.id, 1],
    ]);
  });

  it("rejoindre un Live inconnu : `live_not_found` puis fermeture", async () => {
    const { socket, reply } = await join("lv_inexistant", noa);

    expect(reply).toMatchObject({ type: "error", code: "live_not_found" });
    expect(await socket.closed).toEqual({ code: 1008 });
  });

  it("sans `join` sous 5 s, le socket est fermé", async () => {
    const created = await launch(lea);
    const socket = await open(created.id);

    live.clock.advance(4_999);
    expect(socket.isOpen).toBe(true);
    live.clock.advance(1);

    expect(await socket.closed).toEqual({ code: 1008 });
  });

  it("ping toutes les 20 s : sans pong avant le ping suivant, le socket est coupé", async () => {
    const created = await launch(lea);
    const healthy = (await join(created.id, sam)).socket;
    const silent = (await join(created.id, noa, { autoPong: false })).socket;

    const pinged = Promise.all([healthy.nextPing(), silent.nextPing()]);
    live.clock.advance(20_000);
    await pinged;
    // Aller-retour : le pong du client sain est traité avant le ping suivant.
    await sync(healthy);
    live.clock.advance(20_000);

    await silent.closed;
    expect(healthy.isOpen).toBe(true);
  });

  it("un second `join` du même Participant remplace l'ancien socket", async () => {
    const created = await launch(lea);
    const first = await join(created.id, noa);

    const second = await join(created.id, noa);

    expect(second.reply).toMatchObject({ type: "snapshot", audience: { total: 1 } });
    expect(await first.socket.next()).toEqual({ type: "replaced" });
    expect(await first.socket.closed).toEqual({ code: 1000 });
    // La fermeture de l'ancien socket, une fois traitée, ne fait pas sortir le Participant.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await listLives())[0]?.audience).toBe(1);
  });

  describe("Audience", () => {
    it("diffusée à tous au plus toutes les 2 s, détaillée par App d'origine, Hôte exclu", async () => {
      const created = await launch(lea);
      const host = await join(created.id, lea);
      const viewers = [await join(created.id, noa), await join(created.id, sam)];

      live.clock.advance(1_999);
      await sync(host.socket);
      live.clock.advance(1);

      const audience = { type: "audience", total: 2, byApp: { "demo-android": 1, "demo-ios": 1 } };
      expect(await host.socket.next()).toEqual(audience);
      for (const viewer of viewers) expect(await viewer.socket.next()).toEqual(audience);
    });

    it("pas de diffusion si elle n'a pas changé : l'Hôte qui décroche et revient ne compte pas", async () => {
      const created = await launch(lea);
      const host = await join(created.id, lea);
      const viewer = await join(created.id, noa);
      live.clock.advance(2_000);
      expect(await viewer.socket.next()).toMatchObject({ type: "audience", total: 1 });

      host.socket.close();
      expect(await viewer.socket.next()).toEqual({ type: "hostDisconnected" });
      await join(created.id, lea);
      expect(await viewer.socket.next()).toEqual({ type: "hostReconnected" });
      live.clock.advance(2_000);

      await sync(viewer.socket, { strict: true });
    });
  });

  describe("présence de l'Hôte et Délai de grâce", () => {
    it("l'Hôte décroche puis revient : les autres reçoivent `hostDisconnected` puis `hostReconnected`", async () => {
      const created = await launch(lea);
      const host = await join(created.id, lea);
      const viewer = await join(created.id, noa);

      host.socket.close();
      expect(await viewer.socket.next()).toEqual({ type: "hostDisconnected" });

      const back = await join(created.id, lea);
      expect(back.reply).toMatchObject({ type: "snapshot", role: "host", hostConnected: true });
      expect(await viewer.socket.next()).toEqual({ type: "hostReconnected" });
    });

    it("sans retour de l'Hôte sous 60 s, le Live se termine : `liveEnded`, room supprimée, sockets fermés", async () => {
      const created = await launch(lea);
      const host = await join(created.id, lea);
      const viewer = await join(created.id, noa);
      host.socket.close();
      expect(await viewer.socket.next()).toEqual({ type: "hostDisconnected" });

      await elapse(59_999, [viewer.socket]);
      expect(viewer.socket.isOpen).toBe(true);
      live.clock.advance(1);

      expect(await viewer.socket.next()).toEqual({ type: "liveEnded", reason: "hostTimeout" });
      expect(await viewer.socket.closed).toEqual({ code: 1000 });
      expect(live.livekit.openRooms).toEqual([]);
      expect(await listLives()).toEqual([]);
      expect((await join(created.id, lea)).reply).toMatchObject({ type: "error", code: "live_not_found" });
    });

    it("un Live lancé dont l'Hôte ne se connecte jamais se termine au bout du Délai de grâce", async () => {
      await launch(lea);

      live.clock.advance(60_000);

      await expect.poll(listLives).toEqual([]);
      expect(live.livekit.openRooms).toEqual([]);
    });

    it("l'Hôte qui revient dans le Délai de grâce garde son Live", async () => {
      const created = await launch(lea);
      const host = await join(created.id, lea);
      const viewer = await join(created.id, noa);
      host.socket.close();
      expect(await viewer.socket.next()).toEqual({ type: "hostDisconnected" });

      await elapse(59_000, [viewer.socket]);
      const back = await join(created.id, lea);
      expect(await viewer.socket.next()).toEqual({ type: "hostReconnected" });
      await elapse(60_000, [viewer.socket, back.socket]);

      expect(viewer.socket.isOpen).toBe(true);
      expect((await listLives()).map((l) => l.id)).toEqual([created.id]);
    });
  });

  describe("redémarrage du serveur en plein Live", () => {
    /** Coupe le serveur (sockets compris) et en démarre un neuf sur la même base, horloge remise à `now`. */
    async function restart() {
      await live.server.close();
      live = await startLiveServer();
    }

    it("les Participants refont `join`, l'Audience se reconstruit ; sans l'Hôte, le Live se termine", async () => {
      const created = await launch(lea);
      await join(created.id, lea);
      await join(created.id, noa);
      await join(created.id, sam);

      await restart();
      const viewer = await join(created.id, noa);
      const other = await join(created.id, sam);

      expect(viewer.reply).toMatchObject({ type: "snapshot", hostConnected: false, audience: { total: 1 } });
      expect(other.reply).toMatchObject({ audience: { total: 2 } });
      expect((await listLives()).map((l) => [l.id, l.audience])).toEqual([[created.id, 2]]);
      expect(live.livekit.calls).not.toContainEqual(expect.objectContaining({ op: "createRoom" }));

      await elapse(59_999, [viewer.socket, other.socket]);
      expect(viewer.socket.isOpen).toBe(true);
      live.clock.advance(1);

      expect(await viewer.socket.next()).toEqual({ type: "liveEnded", reason: "hostTimeout" });
      expect(await other.socket.next()).toEqual({ type: "liveEnded", reason: "hostTimeout" });
      expect(live.livekit.calls).toContainEqual({ op: "deleteRoom", room: created.id });
      expect(await listLives()).toEqual([]);
    });

    it("l'Hôte qui revient après le redémarrage garde son Live", async () => {
      const created = await launch(lea);
      await join(created.id, lea);

      await restart();
      const host = await join(created.id, lea);
      await elapse(60_000, [host.socket]);

      expect(host.socket.isOpen).toBe(true);
      expect((await listLives()).map((l) => l.id)).toEqual([created.id]);
    });

    it("si personne ne revient, le Live se termine au bout du Délai de grâce", async () => {
      const created = await launch(lea);
      await join(created.id, lea);

      await restart();
      live.clock.advance(60_000);

      await expect.poll(listLives).toEqual([]);
      expect(live.livekit.calls).toContainEqual({ op: "deleteRoom", room: created.id });
    });
  });

  it("`endLive` : seul l'Hôte termine, tout le monde reçoit `liveEnded`, room supprimée, sockets fermés", async () => {
    const created = await launch(lea);
    const host = await join(created.id, lea);
    const viewer = await join(created.id, noa);

    viewer.socket.send({ type: "endLive", ref: "v1" });
    expect(await viewer.socket.next()).toMatchObject({ type: "error", ref: "v1", code: "not_host" });

    host.socket.send({ type: "endLive", ref: "c1" });

    expect(await host.socket.next()).toEqual({ type: "ack", ref: "c1" });
    expect(await host.socket.next()).toEqual({
      type: "liveEnded",
      reason: "endedByHost",
      summary: { purchases: 0, reactions: 0, peakAudience: 1 },
    });
    expect(await viewer.socket.next()).toEqual({ type: "liveEnded", reason: "endedByHost" });
    expect(await host.socket.closed).toEqual({ code: 1000 });
    expect(await viewer.socket.closed).toEqual({ code: 1000 });
    expect(live.livekit.openRooms).toEqual([]);
    expect(await listLives()).toEqual([]);
    expect((await join(created.id, sam)).reply).toMatchObject({ type: "error", code: "live_not_found" });
  });
});
