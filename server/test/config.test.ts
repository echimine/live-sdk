import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { bearer, participantToken, startTestServer } from "./support.js";

const fixturePath = fileURLToPath(new URL("../../protocol/fixtures/config.json", import.meta.url));
const fixture = readFileSync(fixturePath);
/** ETag attendu : hash du fichier de config, calculé indépendamment du serveur. */
const expectedETag = `"${createHash("sha256").update(fixture).digest("base64url")}"`;

describe("GET /v1/config", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function getConfig(headers: Record<string, string> = {}) {
    server ??= await startTestServer();
    return server.inject({ method: "GET", url: "/v1/config", headers });
  }

  it("sert la config, conforme à la fixture, avec l'ETag du fichier", async () => {
    const response = await getConfig(bearer(await participantToken()));

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.json()).toStrictEqual(JSON.parse(fixture.toString("utf8")));
    expect(response.headers.etag).toBe(expectedETag);
  });

  it("répond 304 sans corps si l'ETag n'a pas changé", async () => {
    const response = await getConfig({ ...bearer(await participantToken()), "if-none-match": expectedETag });

    expect(response.statusCode).toBe(304);
    expect(response.body).toBe("");
    expect(response.headers.etag).toBe(expectedETag);
  });

  it("sert la config si l'ETag connu est périmé", async () => {
    const response = await getConfig({ ...bearer(await participantToken()), "if-none-match": '"perime"' });

    expect(response.statusCode).toBe(200);
  });

  it("exige un Jeton de Participant", async () => {
    const response = await getConfig({ "if-none-match": expectedETag });

    expect(response.statusCode).toBe(401);
  });
});
