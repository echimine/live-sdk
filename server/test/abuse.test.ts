import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpError, LivesCreateResponse } from "../src/protocol/index.js";
import type { TestSocket } from "./fakes.js";
import { bearer, participantToken, resetDatabase, startLiveServer, type LiveServer } from "./support.js";

describe("quotas HTTP", () => {
  let live: LiveServer;

  beforeEach(async () => {
    await resetDatabase();
    live = await startLiveServer();
  });

  afterEach(async () => {
    await live.server.close();
  });

  async function launch(sub: string, remoteAddress = "203.0.113.1") {
    return live.server.inject({
      method: "POST",
      url: "/v1/lives",
      headers: bearer(await participantToken({ sub })),
      remoteAddress,
    });
  }

  it("`POST /v1/lives` : 5 par minute et par Participant, puis `429` + `Retry-After`", async () => {
    for (let i = 0; i < 5; i++) expect((await launch("u_1")).statusCode).toBeLessThan(300);

    const refused = await launch("u_1");

    expect(refused.statusCode).toBe(429);
    expect(HttpError.parse(refused.json()).error.code).toBe("rate_limited");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    // Un autre Participant, même depuis la même IP, n'est pas touché.
    expect((await launch("u_2")).statusCode).toBe(201);

    live.clock.advance(60_000);
    expect((await launch("u_1")).statusCode).toBeLessThan(300);
  });

  it("`GET /v1/…` : 60 par minute et par IP, toutes routes confondues, puis `429` + `Retry-After`", async () => {
    const headers = bearer(await participantToken());
    const get = (url: string, remoteAddress: string) =>
      live.server.inject({ method: "GET", url, headers, remoteAddress });

    for (let i = 0; i < 30; i++) {
      expect((await get("/v1/lives", "203.0.113.1")).statusCode).toBe(200);
      expect((await get("/v1/config", "203.0.113.1")).statusCode).toBe(200);
    }

    const refused = await get("/v1/config", "203.0.113.1");
    expect(refused.statusCode).toBe(429);
    expect(HttpError.parse(refused.json()).error.code).toBe("rate_limited");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect((await get("/v1/lives", "203.0.113.2")).statusCode).toBe(200);

    // L'exploitation reste joignable depuis une IP saturée (Wi-Fi de la salle).
    expect((await get("/health", "203.0.113.1")).statusCode).not.toBe(429);

    live.clock.advance(60_000);
    expect((await get("/v1/lives", "203.0.113.1")).statusCode).toBe(200);
  });

  it("derrière le proxy (`TRUST_PROXY`), le quota par IP suit `X-Forwarded-For`", async () => {
    await live.server.close();
    live = await startLiveServer({ env: { TRUST_PROXY: "1" } });
    const headers = bearer(await participantToken());
    const get = (client: string) =>
      live.server.inject({
        method: "GET",
        url: "/v1/config",
        headers: { ...headers, "x-forwarded-for": client },
        remoteAddress: "172.19.0.2",
      });

    for (let i = 0; i < 60; i++) expect((await get("198.51.100.1")).statusCode).toBe(200);

    expect((await get("198.51.100.1")).statusCode).toBe(429);
    expect((await get("198.51.100.2")).statusCode).toBe(200);
  });
});

describe("limites du WebSocket du Live", () => {
  let live: LiveServer;
  let liveId: string;
  const sockets: TestSocket[] = [];

  beforeEach(async () => {
    await resetDatabase();
    live = await startLiveServer();
    const response = await live.server.inject({
      method: "POST",
      url: "/v1/lives",
      headers: bearer(await participantToken({ sub: "hote" })),
    });
    liveId = LivesCreateResponse.parse(response.json()).live.id;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await live.server.close();
  });

  async function open() {
    const socket = await live.openSocket(liveId);
    sockets.push(socket);
    return socket;
  }

  async function join(token: string) {
    const socket = await open();
    socket.send({ type: "join", token });
    return { socket, reply: await socket.next() };
  }

  it("`join` : 10 par minute et par Participant, puis `rate_limited` et fermeture 1008", async () => {
    const token = await participantToken({ sub: "u_1" });
    for (let i = 0; i < 10; i++) expect((await join(token)).reply).toMatchObject({ type: "snapshot" });

    const { socket, reply } = await join(token);

    expect(reply).toMatchObject({ type: "error", code: "rate_limited", retryAfterMs: expect.any(Number) });
    expect(await socket.closed).toEqual({ code: 1008 });
    expect((await join(await participantToken({ sub: "u_2" }))).reply).toMatchObject({ type: "snapshot" });
  });

  it("jetons invalides : 30 par minute et par IP, puis `rate_limited` ; un jeton valide passe toujours", async () => {
    const forged = await participantToken({ sub: "u_1" }, "un-secret-qui-n-est-pas-celui-de-l-app");
    for (let i = 0; i < 20; i++) expect((await join(forged)).reply).toMatchObject({ code: "invalid_token" });
    // Un `join` illisible compte comme un jeton refusé.
    for (let i = 0; i < 10; i++) {
      const socket = await open();
      socket.send({ type: "join" });
      expect(await socket.next()).toMatchObject({ code: "invalid_command" });
    }

    const { socket, reply } = await join(forged);

    expect(reply).toMatchObject({ type: "error", code: "rate_limited", retryAfterMs: expect.any(Number) });
    expect(await socket.closed).toEqual({ code: 1008 });
    expect((await join(await participantToken({ sub: "u_2" }))).reply).toMatchObject({ type: "snapshot" });
  });

  it("autres commandes : 10 par 10 s et par Participant, puis `rate_limited` avec `retryAfterMs`", async () => {
    const { socket } = await join(await participantToken({ sub: "u_1" }));
    // Une commande sans `ref` valide consomme aussi le quota.
    socket.send({ type: "endLive" });
    expect(await socket.next()).toMatchObject({ code: "invalid_command" });
    for (let i = 1; i < 10; i++) {
      socket.send({ type: "endLive", ref: `c${i}` });
      expect(await socket.next()).toMatchObject({ ref: `c${i}`, code: "not_host" });
    }

    socket.send({ type: "endLive", ref: "c10" });
    const refused = await socket.next();

    expect(refused).toMatchObject({ type: "error", ref: "c10", code: "rate_limited" });
    expect(refused.retryAfterMs).toBe(10_000);
    expect(socket.isOpen).toBe(true);
    live.clock.advance(10_000);
    socket.send({ type: "endLive", ref: "c11" });
    // Entre-temps, des événements (Audience…) ont pu arriver : on va jusqu'à la réponse.
    let reply = await socket.next();
    while (reply.ref !== "c11") reply = await socket.next();
    expect(reply).toMatchObject({ code: "not_host" });
  });

  it("une trame de plus de 16 Ko ferme le socket en 1008", async () => {
    const { socket } = await join(await participantToken({ sub: "u_1" }));
    const exactly16K = JSON.stringify({ type: "x", pad: "" });
    socket.send(JSON.stringify({ type: "x", pad: "a".repeat(16 * 1024 - exactly16K.length) }));
    socket.send({ type: "pasUneCommande", ref: "sync" });
    expect(await socket.next()).toMatchObject({ ref: "sync", code: "unknown_command" });

    socket.send(JSON.stringify({ type: "x", pad: "a".repeat(16 * 1024 - exactly16K.length + 1) }));

    expect(await socket.closed).toEqual({ code: 1008 });
  });

  it("plus de 50 trames par seconde ferment le socket en 1008", async () => {
    const { socket } = await join(await participantToken({ sub: "u_1" }));
    live.clock.advance(1_000);
    for (let i = 0; i < 49; i++) socket.send({ type: "react", emoji: "❤️" });
    socket.send({ type: "pasUneCommande", ref: "sync" });
    expect(await socket.next()).toMatchObject({ ref: "sync", code: "unknown_command" });

    socket.send({ type: "react", emoji: "❤️" });

    expect(await socket.closed).toEqual({ code: 1008 });
  });
});
