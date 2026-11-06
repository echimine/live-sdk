import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClientMessage, Config, httpMessages, ServerMessage } from "../src/protocol/index.js";

const fixturesDir = fileURLToPath(new URL("../../protocol/fixtures/", import.meta.url));

function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(`${fixturesDir}${path}`, "utf8"));
}

/** Fixtures d'un dossier : `name` est le nom de fichier sans `.json`. */
function listFixtures(dir: string): { file: string; name: string; path: string }[] {
  return readdirSync(`${fixturesDir}${dir}`)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ file, name: file.slice(0, -".json".length), path: `${dir}/${file}` }));
}

/** Décode avec le schéma, réencode en JSON, et relit : c'est ce qui part sur le fil. */
function roundTrip(schema: { parse(value: unknown): unknown }, raw: unknown): unknown {
  return JSON.parse(JSON.stringify(schema.parse(raw)));
}

describe("contrat : config", () => {
  it("la fixture de config se décode puis se réencode à l'identique", () => {
    const raw = readFixture("config.json");

    expect(roundTrip(Config, raw)).toStrictEqual(raw);
  });
});

describe("contrat : HTTP /v1/", () => {
  const fixtures = listFixtures("http");

  it("chaque message HTTP a sa fixture", () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual(Object.keys(httpMessages).sort());
  });

  it.each(fixtures)("http/$file se décode puis se réencode à l'identique", ({ name, path }) => {
    const schema = httpMessages[name as keyof typeof httpMessages];
    const raw = readFixture(path);

    expect(roundTrip(schema, raw)).toStrictEqual(raw);
  });
});

describe("contrat : erreurs WebSocket", () => {
  it("rate_limited exige retryAfterMs, et aucun autre code ne le porte", () => {
    const base = { type: "error", ref: "c1", message: "…" };

    expect(ServerMessage.safeParse({ ...base, code: "rate_limited" }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...base, code: "banned", retryAfterMs: 1000 }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...base, code: "rate_limited", retryAfterMs: 1000 }).success).toBe(true);
  });
});

/** Valeurs du discriminant `type` d'une union de messages WebSocket. */
function messageTypes(union: { options: readonly { shape: { type: { value: string } } }[] }) {
  return union.options.map((option) => option.shape.type.value).sort();
}

/** `snapshot.host.json` → `snapshot` : un suffixe distingue les variantes d'un même type. */
function typeOfFixture(name: string): string {
  return name.split(".")[0]!;
}

describe.each([
  { side: "client", union: ClientMessage },
  { side: "server", union: ServerMessage },
])("contrat : WebSocket, messages $side", ({ side, union }) => {
  const fixtures = listFixtures(`ws/${side}`);

  it("chaque type de message a au moins une fixture", () => {
    const covered = [...new Set(fixtures.map((f) => typeOfFixture(f.name)))].sort();

    expect(covered).toEqual(messageTypes(union));
  });

  it.each(fixtures)(`ws/${side}/$file se décode puis se réencode à l'identique`, ({ name, path }) => {
    const raw = readFixture(path);

    expect(raw).toMatchObject({ type: typeOfFixture(name) });
    expect(roundTrip(union, raw)).toStrictEqual(raw);
  });
});
