import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
  },
  // Un seul Live en cours par Hôte : garantit l'idempotence du lancement, même en concurrence.
  (table) => [uniqueIndex("lives_one_running_per_host").on(table.hostId).where(sql`${table.endedAt} is null`)],
);
