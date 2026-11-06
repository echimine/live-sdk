import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImagesUploadResponse } from "../src/protocol/index.js";
import { bearer, participantToken, startTestServer } from "./support.js";

/** Premiers octets de chaque format accepté, suivis de quoi faire une « image ». */
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 2)]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(32, 3)]);
const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32, 4)]);

describe("images du Produit épinglé", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  async function upload(body: Buffer, contentType = "image/jpeg", claims = {}) {
    return server.inject({
      method: "POST",
      url: "/v1/images",
      headers: { ...bearer(await participantToken(claims)), "content-type": contentType },
      payload: body,
    });
  }

  it.each([
    ["JPEG", jpeg, "image/jpeg", /\.jpg$/],
    ["PNG", png, "image/png", /\.png$/],
    ["WebP", webp, "image/webp", /\.webp$/],
  ])("une image %s est enregistrée, puis servie telle quelle sans jeton", async (_format, bytes, type, extension) => {
    const response = await upload(bytes, type);

    expect(response.statusCode).toBe(201);
    const { url } = ImagesUploadResponse.parse(response.json());
    expect(url).toMatch(/^https:\/\/live\.echimine\.fr\/v1\/images\/img_[a-z0-9]+\./);
    expect(url).toMatch(extension);

    const served = await server.inject({ method: "GET", url: new URL(url).pathname });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe(type);
    expect(served.rawPayload.equals(bytes)).toBe(true);
  });

  it("le format est lu sur les premiers octets, pas sur l'en-tête : un PNG annoncé en JPEG reste un PNG", async () => {
    const response = await upload(png, "application/octet-stream");

    expect(response.statusCode).toBe(201);
    expect(ImagesUploadResponse.parse(response.json()).url).toMatch(/\.png$/);
  });

  it("un fichier qui n'est ni JPEG, ni PNG, ni WebP est refusé en 415, même annoncé en JPEG", async () => {
    for (const body of [gif, Buffer.from("pas une image"), Buffer.alloc(0)]) {
      const response = await upload(body, "image/jpeg");
      expect(response.statusCode).toBe(415);
      expect(response.json()).toEqual({ error: { code: "unsupported_media_type", message: expect.any(String) } });
    }
  });

  it("une image de plus de 10 Mo est refusée en 413", async () => {
    const tooBig = Buffer.concat([jpeg, Buffer.alloc(10 * 1024 * 1024)]);

    const response = await upload(tooBig);

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: { code: "payload_too_large", message: expect.any(String) } });
  });

  it("l'envoi exige un Jeton de Participant", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/images",
      headers: { "content-type": "image/jpeg" },
      payload: jpeg,
    });

    expect(response.statusCode).toBe(401);
  });

  it("10 envois par minute et par Participant, puis 429 avec Retry-After", async () => {
    for (let i = 0; i < 10; i++) expect((await upload(jpeg)).statusCode).toBe(201);

    const limited = await upload(jpeg);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    // Un autre Participant n'est pas concerné.
    expect((await upload(jpeg, "image/jpeg", { sub: "autre" })).statusCode).toBe(201);
  });

  it("une image inconnue, ou un nom qui sort du dossier, répond 404", async () => {
    for (const name of ["img_aaaaaaaaaaaaaaaa.jpg", "..%2Fpackage.json", "img_x.gif"]) {
      const response = await server.inject({ method: "GET", url: `/v1/images/${name}` });
      expect(response.statusCode).toBe(404);
    }
  });
});
