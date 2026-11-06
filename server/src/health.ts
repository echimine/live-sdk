import type { Sql } from "postgres";

const PROBE_TIMEOUT_MS = 2000;

export type PostgresHealth = "ok" | "unreachable";
export type LivekitHealth = "ok" | "unreachable" | "not_configured";

export interface Health {
  /** `unavailable` dès que Postgres est KO ; LiveKit est seulement informatif. */
  status: "ok" | "unavailable";
  postgres: PostgresHealth;
  livekit: LivekitHealth;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS).unref()),
  ]);
}

async function probePostgres(sql: Sql): Promise<PostgresHealth> {
  try {
    await withTimeout(sql`select 1`);
    return "ok";
  } catch {
    return "unreachable";
  }
}

/** LiveKit répond en HTTP sur la même adresse que son signal WebSocket. */
async function probeLivekit(livekitUrl: string | undefined): Promise<LivekitHealth> {
  if (livekitUrl === undefined) return "not_configured";
  try {
    const url = new URL(livekitUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.status < 500 ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function checkHealth(sql: Sql, livekitUrl: string | undefined): Promise<Health> {
  const [postgres, livekit] = await Promise.all([probePostgres(sql), probeLivekit(livekitUrl)]);
  return { status: postgres === "ok" ? "ok" : "unavailable", postgres, livekit };
}
