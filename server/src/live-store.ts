import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { postgresCode } from "./db/postgres-error.js";
import { lives } from "./db/schema.js";
import { opaqueId } from "./ids.js";
import type { Participant } from "./protocol/index.js";

export interface Live {
  id: string;
  title?: string;
  host: Participant;
  startedAt: Date;
}

export type EndReason = "endedByHost" | "hostTimeout";

type Row = typeof lives.$inferSelect;

function toLive(row: Row): Live {
  return {
    id: row.id,
    ...(row.title !== null && { title: row.title }),
    host: {
      id: row.hostId,
      app: row.hostApp,
      name: row.hostName,
      ...(row.hostPicture !== null && { picture: row.hostPicture }),
    },
    startedAt: row.startedAt,
  };
}

/** Identifiant opaque d'un Live, aussi nom de sa room LiveKit : `lv_` + 12 caractères. */
export function newLiveId(): string {
  return opaqueId("lv_", 12);
}

/** Lives persistés dans Postgres ; un Live est en cours tant que `ended_at` est nul. */
export class LiveStore {
  constructor(private readonly db: PostgresJsDatabase) {}

  async findRunning(id: string): Promise<Live | undefined> {
    const [row] = await this.db.select().from(lives).where(and(eq(lives.id, id), isNull(lives.endedAt)));
    return row && toLive(row);
  }

  async findRunningByHost(hostId: string): Promise<Live | undefined> {
    const [row] = await this.db.select().from(lives).where(and(eq(lives.hostId, hostId), isNull(lives.endedAt)));
    return row && toLive(row);
  }

  async listRunning(): Promise<Live[]> {
    const rows = await this.db.select().from(lives).where(isNull(lives.endedAt));
    return rows.map(toLive);
  }

  /**
   * Enregistre un Live. Rend `undefined` si l'Hôte a déjà un Live en cours
   * (lancement concurrent) : l'index unique partiel en est le garant.
   */
  async insert(live: Live): Promise<Live | undefined> {
    try {
      await this.db.insert(lives).values({
        id: live.id,
        title: live.title ?? null,
        hostId: live.host.id,
        hostApp: live.host.app,
        hostName: live.host.name,
        hostPicture: live.host.picture ?? null,
        startedAt: live.startedAt,
      });
      return live;
    } catch (error) {
      // Violation d'unicité : l'Hôte a déjà un Live en cours.
      if (postgresCode(error) === "23505") return undefined;
      throw error;
    }
  }

  async end(id: string, reason: EndReason, at: Date): Promise<void> {
    await this.db
      .update(lives)
      .set({ endedAt: at, endReason: reason })
      .where(and(eq(lives.id, id), isNull(lives.endedAt)));
  }
}
