import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { startTestServer } from "./support.js";

/** Postgres injoignable : rien n'écoute sur le port 1. */
const unreachableDatabaseUrl = "postgres://live:live@127.0.0.1:1/live";

describe("GET /health", () => {
  let server: FastifyInstance | undefined;
  let fakeLivekit: Server | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await new Promise((resolve) => (fakeLivekit ? fakeLivekit.close(resolve) : resolve(undefined)));
    fakeLivekit = undefined;
  });

  /** Faux LiveKit : répond `OK` sur `/`, comme le vrai. */
  async function startFakeLivekit(): Promise<string> {
    fakeLivekit = createHttpServer((_req, res) => res.end("OK"));
    await new Promise<void>((resolve) => fakeLivekit!.listen(0, "127.0.0.1", resolve));
    return `ws://127.0.0.1:${(fakeLivekit.address() as AddressInfo).port}`;
  }

  async function health(env: Record<string, string> = {}) {
    server = await startTestServer(env);
    return server.inject({ method: "GET", url: "/health" });
  }

  it("répond 200 sans jeton quand le process et Postgres vont bien", async () => {
    const response = await health();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", postgres: "ok", livekit: "not_configured" });
  });

  it("répond 503 quand Postgres est injoignable", async () => {
    const response = await health({ DATABASE_URL: unreachableDatabaseUrl });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable", postgres: "unreachable", livekit: "not_configured" });
  });

  it("traite un LIVEKIT_URL vide comme absent", async () => {
    const response = await health({ LIVEKIT_URL: "" });

    expect(response.json()).toMatchObject({ livekit: "not_configured" });
  });

  it("rapporte un LiveKit joignable", async () => {
    const response = await health({ LIVEKIT_URL: await startFakeLivekit() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ livekit: "ok" });
  });

  it("rapporte un LiveKit injoignable sans échouer", async () => {
    const response = await health({ LIVEKIT_URL: "ws://127.0.0.1:1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", postgres: "ok", livekit: "unreachable" });
  });
});
