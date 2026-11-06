import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import postgres from "postgres";
import { type Clock, systemClock } from "../src/clock.js";
import type { LivekitPort } from "../src/livekit.js";
import { createServer, type ServerEnv } from "../src/server.js";
import { FakeLivekit, ManualClock, TestSocket } from "./fakes.js";

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
  // Dossier d'images propre à chaque serveur de test.
  const IMAGES_DIR = mkdtempSync(join(tmpdir(), "live-sdk-images-"));
  return { DATABASE_URL: databaseUrl, MEMBER_APPS_FILE: memberAppsFile, IMAGES_DIR, ...overrides };
}

/**
 * Serveur commun branché sur les App membres de test, un faux LiveKit et une
 * horloge figée sur `now` (ou l'horloge donnée).
 */
export function startTestServer(
  env: Partial<ServerEnv> = {},
  clock: Clock | (() => Date) = () => now,
  livekit: LivekitPort = new FakeLivekit(),
  logStream?: Writable,
) {
  const injected = typeof clock === "function" ? { ...systemClock, now: clock } : clock;
  return createServer({ env: testEnv(env), clock: injected, livekit, logger: logStream ? { stream: logStream } : false });
}

export interface LiveServer {
  server: FastifyInstance;
  livekit: FakeLivekit;
  clock: ManualClock;
  /** Base HTTP, par exemple `http://127.0.0.1:51234`. */
  baseUrl: string;
  /** Ouvre `/v1/lives/{id}/ws`. */
  openSocket(liveId: string, options?: { autoPong?: boolean }): Promise<TestSocket>;
}

/**
 * Serveur commun à l'écoute sur un port libre, avec un faux LiveKit et une horloge
 * manuelle. Le journal JSON part dans `logStream` s'il est donné.
 */
export async function startLiveServer(
  options: { logStream?: Writable; env?: Partial<ServerEnv> } = {},
): Promise<LiveServer> {
  const livekit = new FakeLivekit();
  const clock = new ManualClock(now);
  const server = await startTestServer(options.env, clock, livekit, options.logStream);
  await server.listen({ port: 0, host: "127.0.0.1" });
  const { port } = server.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    server,
    livekit,
    clock,
    baseUrl,
    openSocket: (liveId, options) => TestSocket.open(`ws://127.0.0.1:${port}/v1/lives/${liveId}/ws`, options),
  };
}

/** Vide les tables entre deux tests (les fichiers de test tournent l'un après l'autre). */
export async function resetDatabase(): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`truncate table purchases, chat_messages, products, live_cohosts, lives`;
  } finally {
    await sql.end({ timeout: 1 });
  }
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
