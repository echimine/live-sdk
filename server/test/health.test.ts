import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

describe("serveur commun", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it("démarre à vide et répond sur /health", async () => {
    server = buildServer();

    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
