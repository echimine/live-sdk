import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Fichier `MEMBER_APPS_FILE` : App membres et secrets HS256 de leurs Jetons de
 * Participant. Hors dépôt (seul `member-apps.example.json`, factice, est commité).
 */
const MemberAppsFile = z
  .object({
    apps: z
      .array(
        z.object({
          /** Identifiant de l'App membre, `iss` de ses Jetons de Participant. */
          iss: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
          /** Secret HS256 : 32 octets au moins (RFC 7518 §3.2). */
          secret: z.string().min(32),
        }),
      )
      .min(1),
  })
  .refine((file) => new Set(file.apps.map((a) => a.iss)).size === file.apps.length, {
    message: "chaque `iss` doit être unique",
  });

/** Secret de chaque App membre, indexé par `iss`. */
export type MemberApps = ReadonlyMap<string, Uint8Array>;

export function loadMemberApps(path: string): MemberApps {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`MEMBER_APPS_FILE illisible (${path}) : ${(error as Error).message}`);
  }
  const parsed = MemberAppsFile.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`MEMBER_APPS_FILE invalide (${path}) : ${z.prettifyError(parsed.error)}`);
  }
  const encoder = new TextEncoder();
  return new Map(parsed.data.apps.map((app) => [app.iss, encoder.encode(app.secret)]));
}
