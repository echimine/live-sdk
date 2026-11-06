import { sql } from "drizzle-orm";
import { bigserial, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Lives, en cours (`ended_at` nul) ou terminés. L'Hôte est figé au lancement. */
export const lives = pgTable(
  "lives",
  {
    id: text("id").primaryKey(),
    title: text("title"),
    hostId: text("host_id").notNull(),
    hostApp: text("host_app").notNull(),
    hostName: text("host_name").notNull(),
    hostPicture: text("host_picture"),
    startedAt: timestamp("started_at", { withTimezone: true, precision: 3 }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, precision: 3 }),
    endReason: text("end_reason", { enum: ["endedByHost", "hostTimeout"] }),
    /** Total des Réactions, écrit périodiquement pendant le Live et à sa fin. */
    reactionsTotal: integer("reactions_total").notNull().default(0),
  },
  // Un seul Live en cours par Hôte : garantit l'idempotence du lancement, même en concurrence.
  (table) => [uniqueIndex("lives_one_running_per_host").on(table.hostId).where(sql`${table.endedAt} is null`)],
);

/**
 * Historique du chat, conservé après la fin du Live. Une suppression est marquée
 * (`deleted_at`), jamais effacée. `seq` ordonne les messages d'un même instant.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    id: text("id").notNull().unique(),
    liveId: text("live_id")
      .notNull()
      .references(() => lives.id),
    authorId: text("author_id").notNull(),
    authorApp: text("author_app").notNull(),
    authorName: text("author_name").notNull(),
    authorPicture: text("author_picture"),
    authorRole: text("author_role", { enum: ["host", "cohost", "viewer"] }).notNull(),
    kind: text("kind", { enum: ["text"] }).notNull(),
    text: text("text").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true, precision: 3 }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, precision: 3 }),
  },
  (table) => [index("chat_messages_live_seq").on(table.liveId, table.seq)],
);
