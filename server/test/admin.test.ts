import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LivesCreateResponse } from "../src/protocol/index.js";
import type { TestSocket } from "./fakes.js";
import { bearer, now, participantToken, resetDatabase, startLiveServer, type LiveServer } from "./support.js";

const adminToken = "jeton-admin-de-test-assez-long";

describe("GET /admin/state", () => {
  let live: LiveServer;
  const sockets: TestSocket[] = [];

  beforeEach(async () => {
    await resetDatabase();
    live = await startLiveServer({ env: { ADMIN_TOKEN: adminToken } });
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await live.server.close();
  });

  const state = (headers: Record<string, string> = {}) =>
    live.server.inject({ method: "GET", url: "/admin/state", headers });

  it("refuse sans le bon `ADMIN_TOKEN`", async () => {
    expect((await state()).statusCode).toBe(401);
    expect((await state(bearer("pas-le-bon-jeton"))).statusCode).toBe(401);
    // Un Jeton de Participant n'ouvre pas l'admin.
    expect((await state(bearer(await participantToken()))).statusCode).toBe(401);
  });

  it("décrit les Lives en cours et leurs connexions", async () => {
    const response = await live.server.inject({
      method: "POST",
      url: "/v1/lives",
      headers: bearer(await participantToken({ sub: "u_1042", name: "Léa" })),
      payload: { title: "Baskets" },
    });
    const created = LivesCreateResponse.parse(response.json()).live;
    const socket = await live.openSocket(created.id);
    sockets.push(socket);
    socket.send({ type: "join", token: await participantToken({ iss: "demo-android", sub: "u_88", name: "Noa" }) });
    await socket.next();

    const reply = await state(bearer(adminToken));

    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({
      now: now.toISOString(),
      uptimeSeconds: expect.any(Number),
      connections: 1,
      lives: [
        {
          id: created.id,
          title: "Baskets",
          host: { id: "demo-ios:u_1042", app: "demo-ios", name: "Léa" },
          startedAt: now.toISOString(),
          hostConnected: false,
          audience: { total: 1, byApp: { "demo-android": 1 } },
          connections: 1,
        },
      ],
    });
  });

  it("n'existe pas sans `ADMIN_TOKEN` configuré", async () => {
    await live.server.close();
    live = await startLiveServer();

    expect((await state(bearer(adminToken))).statusCode).toBe(404);
  });
});
