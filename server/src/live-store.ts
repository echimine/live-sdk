import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { participantColumns, toParticipant } from "./db/participant.js";
import { postgresCode } from "./db/postgres-error.js";
import { liveCohosts, lives } from "./db/schema.js";
import { opaqueId } from "./ids.js";
import type { Participant } from "./protocol/index.js";

export interface Live {
  id: string;
  title?: string;
  host: Participant;
  startedAt: Date;
  /** Total des Réactions au dernier enregistrement. */
  reactionsTotal: number;
  /** Audience maximale au dernier enregistrement. */
  peakAudience: number;
}

export type EndReason = "endedByHost" | "hostTimeout";

type Row = typeof lives.$inferSelect;

function toLive(row: Row): Live {
  return {
    id: row.id,
    ...(row.title !== null && { title: row.title }),
    host: toParticipant(row, "host"),
    startedAt: row.startedAt,
    reactionsTotal: row.reactionsTotal,
    peakAudience: row.peakAudience,
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

  /** Un Live terminé, avec ses totaux de fin ; `undefined` s'il est inconnu ou encore en cours. */
  async findEnded(id: string): Promise<Live | undefined> {
    const [row] = await this.db.select().from(lives).where(and(eq(lives.id, id), isNotNull(lives.endedAt)));
    return row && toLive(row);
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
        ...participantColumns(live.host, "host"),
        startedAt: live.startedAt,
      });
      return live;
    } catch (error) {
      // Violation d'unicité : l'Hôte a déjà un Live en cours.
      if (postgresCode(error) === "23505") return undefined;
      throw error;
    }
  }

  /** Co-hôtes actuels d'un Live, par ordre de montée. */
  async listCohosts(liveId: string): Promise<Participant[]> {
    const rows = await this.db
      .select()
      .from(liveCohosts)
      .where(eq(liveCohosts.liveId, liveId))
      .orderBy(asc(liveCohosts.seq));
    return rows.map((row) => toParticipant(row, "participant"));
  }

  async addCohost(liveId: string, cohost: Participant, at: Date): Promise<void> {
    await this.db
      .insert(liveCohosts)
      .values({ liveId, ...participantColumns(cohost, "participant"), promotedAt: at })
      .onConflictDoNothing();
  }

  async removeCohost(liveId: string, participantId: string): Promise<void> {
    await this.db
      .delete(liveCohosts)
      .where(and(eq(liveCohosts.liveId, liveId), eq(liveCohosts.participantId, participantId)));
  }

  /** Termine un Live, avec son total final de Réactions et son Audience maximale. */
  async end(id: string, reason: EndReason, at: Date, reactionsTotal: number, peakAudience: number): Promise<void> {
    await this.db
      .update(lives)
      .set({
        endedAt: at,
        endReason: reason,
        reactionsTotal: greatest(lives.reactionsTotal, reactionsTotal),
        peakAudience: greatest(lives.peakAudience, peakAudience),
      })
      .where(and(eq(lives.id, id), isNull(lives.endedAt)));
  }

  /** Enregistre le total des Réactions d'un Live ; un total plus ancien n'écrase jamais un plus récent. */
  async saveReactionsTotal(id: string, reactionsTotal: number): Promise<void> {
    await this.db
      .update(lives)
      .set({ reactionsTotal: greatest(lives.reactionsTotal, reactionsTotal) })
      .where(eq(lives.id, id));
  }

  /** Enregistre l'Audience maximale d'un Live ; une valeur plus ancienne n'écrase jamais une plus grande. */
  async savePeakAudience(id: string, peakAudience: number): Promise<void> {
    await this.db
      .update(lives)
      .set({ peakAudience: greatest(lives.peakAudience, peakAudience) })
      .where(eq(lives.id, id));
  }
}

/** Un compteur qui ne fait que croître : des écritures qui se croisent gardent le plus grand. */
function greatest(column: PgColumn, value: number) {
  return sql`greatest(${column}, ${value})`;
}
