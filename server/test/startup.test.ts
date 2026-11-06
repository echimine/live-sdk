import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { testEnv, writeTempFile } from "./support.js";

const secret = "un-secret-de-test-de-32-octets-au-moins";

describe("démarrage du serveur commun", () => {
  it("démarre avec les App membres de test", async () => {
    const server = await createServer({ env: testEnv() });

    await server.close();
  });

  it.each([
    ["absent", { MEMBER_APPS_FILE: undefined }],
    ["introuvable", { MEMBER_APPS_FILE: "/chemin/qui/n-existe/pas.json" }],
  ])("refuse de démarrer si MEMBER_APPS_FILE est %s", async (_label, overrides) => {
    await expect(createServer({ env: { ...testEnv(), ...overrides } })).rejects.toThrow(/MEMBER_APPS_FILE/);
  });

  it.each([
    ["n'est pas du JSON", "{ apps: "],
    ["ne liste aucune App membre", JSON.stringify({ apps: [] })],
    ["a un secret trop court", JSON.stringify({ apps: [{ iss: "demo", secret: "court" }] })],
    ["a un `iss` invalide", JSON.stringify({ apps: [{ iss: "Demo App", secret }] })],
    [
      "déclare deux fois le même `iss`",
      JSON.stringify({ apps: [{ iss: "demo", secret }, { iss: "demo", secret: `${secret}-2` }] }),
    ],
  ])("refuse de démarrer si le fichier des App membres %s", async (_label, content) => {
    const env = testEnv({ MEMBER_APPS_FILE: writeTempFile("member-apps.json", content) });

    await expect(createServer({ env })).rejects.toThrow(/MEMBER_APPS_FILE/);
  });

  it.each([
    ["absente", undefined],
    ["qui n'est pas une URL Postgres", "mysql://live:live@localhost/live"],
  ])("refuse de démarrer si DATABASE_URL est %s", async (_label, url) => {
    await expect(createServer({ env: { ...testEnv(), DATABASE_URL: url } })).rejects.toThrow(/DATABASE_URL/);
  });

  it("refuse de démarrer si la config servie est invalide", async () => {
    const configFile = writeTempFile("config.json", JSON.stringify({ reactions: ["❤️"] }));

    await expect(createServer({ env: testEnv(), configFile })).rejects.toThrow(/config/i);
  });
});
