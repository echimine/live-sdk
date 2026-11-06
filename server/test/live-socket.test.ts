import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    healthy.send({ type: "pasUneCommande", ref: "sync" });
    expect(await healthy.next()).toMatchObject({ type: "error", ref: "sync", code: "unknown_command" });
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
