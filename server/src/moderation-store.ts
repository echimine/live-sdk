import { and, asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { liveModeration } from "./db/schema.js";
import type { ModerationLists } from "./moderation.js";
import type { Participant } from "./protocol/index.js";

function participantColumns(participant: Participant) {
  return {
    participantId: participant.id,
    participantApp: participant.app,
    participantName: participant.name,
    participantPicture: participant.picture ?? null,
  };
}

/** Shadowbans et Bannissements des Lives, dans Postgres. */
export class ModerationStore {
  constructor(private readonly db: PostgresJsDatabase) {}

  /** Shadowbans et Bannissements de ce Live, par ordre de décision. */
  async lists(liveId: string): Promise<ModerationLists> {
    const rows = await this.db
      .select()
      .from(liveModeration)
      .where(eq(liveModeration.liveId, liveId))
      .orderBy(asc(liveModeration.decidedAt), asc(liveModeration.seq));
    const lists: ModerationLists = { shadowbanned: [], banned: [] };
    for (const row of rows) {
      const participant: Participant = {
        id: row.participantId,
        app: row.participantApp,
        name: row.participantName,
        ...(row.participantPicture !== null && { picture: row.participantPicture }),
      };
      lists[row.status].push(participant);
    }
    return lists;
  }

  /** Met ce Participant en Shadowban, sauf s'il l'est déjà ou est banni. */
  async shadowban(liveId: string, participant: Participant, at: Date): Promise<void> {
    await this.db
      .insert(liveModeration)
      .values({ liveId, ...participantColumns(participant), status: "shadowbanned", decidedAt: at })
      .onConflictDoNothing();
  }

  /** Lève le Shadowban de ce Participant (sans effet sur un Bannissement). */
  async unshadowban(liveId: string, participantId: string): Promise<void> {
    await this.db
      .delete(liveModeration)
      .where(
        and(
          eq(liveModeration.liveId, liveId),
          eq(liveModeration.participantId, participantId),
          eq(liveModeration.status, "shadowbanned"),
        ),
      );
  }

  /** Bannit ce Participant de ce Live, à la place de son Shadowban éventuel. */
  async ban(liveId: string, participant: Participant, at: Date): Promise<void> {
    await this.db
      .insert(liveModeration)
      .values({ liveId, ...participantColumns(participant), status: "banned", decidedAt: at })
      .onConflictDoUpdate({
        target: [liveModeration.liveId, liveModeration.participantId],
        set: { status: "banned", decidedAt: at },
      });
  }
}
