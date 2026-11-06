import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { HttpError, LivesListResponse } from "../src/protocol/index.js";
import { bearer, now, participantToken, startTestServer } from "./support.js";

describe("Jeton de Participant", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function listLives(headers: Record<string, string> = {}) {
    server ??= await startTestServer();
    return server.inject({ method: "GET", url: "/v1/lives", headers });
  }

  function expectInvalidToken(response: { statusCode: number; json(): unknown }) {
    expect(response.statusCode, JSON.stringify(response.json())).toBe(401);
    const body = HttpError.parse(response.json());
    expect(body.error.code).toBe("invalid_token");
  }

  it("un jeton valide d'une App membre ouvre la liste des Lives", async () => {
    const response = await listLives(bearer(await participantToken()));

    expect(response.statusCode).toBe(200);
    expect(LivesListResponse.parse(response.json())).toEqual({ lives: [] });
  });

  it("toute route exige un jeton, même la liste", async () => {
    expectInvalidToken(await listLives());
  });

  it("refuse un jeton qui n'est pas un JWT", async () => {
    expectInvalidToken(await listLives(bearer("pas-un-jwt")));
  });

  it("refuse un jeton dont l'émetteur n'est pas une App membre", async () => {
    const token = await participantToken({ iss: "inconnue" }, "un-secret-quelconque-de-32-octets-au-moins");

    expectInvalidToken(await listLives(bearer(token)));
  });

  it("refuse un jeton signé avec le secret d'une autre App membre", async () => {
    const otherSecret = "secret-factice-demo-android-ne-jamais-utiliser-en-prod";
    const token = await participantToken({ iss: "demo-ios" }, otherSecret);

    expectInvalidToken(await listLives(bearer(token)));
  });

  it("refuse un jeton expiré selon l'horloge du serveur", async () => {
    const token = await participantToken({ expiresIn: 300 });
    server = await startTestServer({}, () => new Date(now.getTime() + 301_000));

    expectInvalidToken(await listLives(bearer(token)));
  });

  it("accepte un jeton encore valide selon l'horloge du serveur", async () => {
    const token = await participantToken({ expiresIn: 300 });
    server = await startTestServer({}, () => new Date(now.getTime() + 299_000));

    expect((await listLives(bearer(token))).statusCode).toBe(200);
  });

  it.each([
    ["absent", undefined],
    ["vide", ""],
    ["de 31 caractères", "a".repeat(31)],
    ["qui n'est pas une chaîne", 42],
  ])("refuse un jeton dont le `name` est %s", async (_label, name) => {
    const token = await participantToken({ name });

    expectInvalidToken(await listLives(bearer(token)));
  });

  it("accepte un `name` de 30 caractères", async () => {
    const token = await participantToken({ name: "é".repeat(30) });

    expect((await listLives(bearer(token))).statusCode).toBe(200);
  });

  it.each([
    ["en http", "http://cdn.example/a.jpg"],
    ["invalide", "pas une url"],
    ["qui n'est pas une chaîne", 7],
  ])("ignore sans refus un `picture` %s", async (_label, picture) => {
    const token = await participantToken({ picture });

    expect((await listLives(bearer(token))).statusCode).toBe(200);
  });
});
