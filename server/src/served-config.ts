import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Config } from "./protocol/index.js";

/**
 * Config servie par `GET /v1/config` : la fixture du contrat elle-même, versionnée
 * dans le dépôt et embarquée dans l'image. Les SDK en embarquent une copie comme
 * valeurs par défaut ; servir ce fichier garantit qu'ils restent identiques.
 * Le chemin est relatif au module, valable depuis `src/` comme depuis `dist/`.
 */
export const defaultConfigFile = fileURLToPath(new URL("../../protocol/fixtures/config.json", import.meta.url));

export interface ServedConfig {
  /** Octets du fichier, servis tels quels. */
  body: Buffer;
  /** ETag fort : hash SHA-256 du fichier. */
  etag: string;
}

export function loadServedConfig(path: string): ServedConfig {
  let body: Buffer;
  let raw: unknown;
  try {
    body = readFileSync(path);
    raw = JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new Error(`Config servie illisible (${path}) : ${(error as Error).message}`);
  }
  const parsed = Config.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Config servie invalide (${path}) : ${z.prettifyError(parsed.error)}`);
  }
  return { body, etag: `"${createHash("sha256").update(body).digest("base64url")}"` };
}

/** `If-None-Match` correspond-il à l'ETag ? (liste séparée par des virgules, ou `*`). */
export function matchesETag(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}
