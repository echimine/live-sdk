import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { createServer, type ServerEnv } from "../src/server.js";

/** App membres de test : celles du fichier d'exemple commité. */
export const memberAppsFile = fileURLToPath(new URL("../member-apps.example.json", import.meta.url));

const memberApps = JSON.parse(readFileSync(memberAppsFile, "utf8")) as {
  apps: { iss: string; secret: string }[];
};

export function secretOf(iss: string): string {
  const app = memberApps.apps.find((a) => a.iss === iss);
  if (!app) throw new Error(`App membre de test inconnue : ${iss}`);
  return app.secret;
}

export const databaseUrl = process.env.DATABASE_URL ?? "postgres://live:live@localhost:5432/live";

/** Instant de référence des tests : l'horloge du serveur est figée dessus. */
export const now = new Date("2026-11-06T18:00:00.000Z");

export function testEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return { DATABASE_URL: databaseUrl, MEMBER_APPS_FILE: memberAppsFile, ...overrides };
}

/** Serveur commun branché sur les App membres de test et une horloge figée sur `now`. */
export function startTestServer(env: Partial<ServerEnv> = {}, clock: () => Date = () => now) {
  return createServer({ env: testEnv(env), now: clock });
}

interface TokenClaims {
  iss?: string;
  sub?: string;
  name?: unknown;
  picture?: unknown;
  /** Expiration en secondes après `now`. */
  expiresIn?: number;
}

/** Jeton de Participant tel que le signerait le backend d'une App membre. */
export async function participantToken(claims: TokenClaims = {}, secret?: string): Promise<string> {
  const { iss = "demo-ios", sub = "u_1", expiresIn = 300, ...rest } = claims;
  // `name: undefined` explicite : le claim est omis.
  const payload: Record<string, unknown> = "name" in rest ? { ...rest } : { name: "Léa", ...rest };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(iss)
    .setSubject(sub)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + expiresIn)
    .sign(new TextEncoder().encode(secret ?? secretOf(iss)));
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function writeTempFile(name: string, content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "live-sdk-")), name);
  writeFileSync(path, content);
  return path;
}
