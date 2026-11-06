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
 * Produits épinglés dans les Lives, conservés après leur retrait. Le Produit
 * épinglé d'un Live est celui dont `unpinned_at` est nul : un seul à la fois.
 */
export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    liveId: text("live_id")
      .notNull()
      .references(() => lives.id),
    name: text("name").notNull(),
    /** En centimes. */
    price: integer("price").notNull(),
    currency: text("currency").notNull(),
    imageUrl: text("image_url"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true, precision: 3 }).notNull(),
    unpinnedAt: timestamp("unpinned_at", { withTimezone: true, precision: 3 }),
  },
  (table) => [uniqueIndex("products_one_pinned_per_live").on(table.liveId).where(sql`${table.unpinnedAt} is null`)],
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
    kind: text("kind", { enum: ["text", "purchase"] }).notNull(),
    /** Texte d'un message `text` ; nul pour une Annonce d'achat. */
    text: text("text"),
    /** Produit acheté, pour une Annonce d'achat (`kind: purchase`). */
    productId: text("product_id").references(() => products.id),
    sentAt: timestamp("sent_at", { withTimezone: true, precision: 3 }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, precision: 3 }),
  },
  (table) => [index("chat_messages_live_seq").on(table.liveId, table.seq)],
);

/** Co-hôtes actuels des Lives ; `seq` donne l'ordre de montée. Un Co-hôte redescendu est retiré. */
export const liveCohosts = pgTable(
  "live_cohosts",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    liveId: text("live_id")
      .notNull()
      .references(() => lives.id),
    participantId: text("participant_id").notNull(),
    participantApp: text("participant_app").notNull(),
    participantName: text("participant_name").notNull(),
    participantPicture: text("participant_picture"),
    promotedAt: timestamp("promoted_at", { withTimezone: true, precision: 3 }).notNull(),
  },
  (table) => [uniqueIndex("live_cohosts_one_per_participant").on(table.liveId, table.participantId)],
);

/**
 * Achats simulés, comptés dans le récapitulatif de fin. `id` est celui de leur
 * Annonce d'achat dans le chat ; supprimer l'annonce ne retire pas l'Achat.
 */
export const purchases = pgTable(
  "purchases",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    id: text("id").notNull().unique(),
    liveId: text("live_id")
      .notNull()
      .references(() => lives.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    buyerId: text("buyer_id").notNull(),
    buyerApp: text("buyer_app").notNull(),
    buyerName: text("buyer_name").notNull(),
    buyerPicture: text("buyer_picture"),
    buyerRole: text("buyer_role", { enum: ["host", "cohost", "viewer"] }).notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true, precision: 3 }).notNull(),
  },
  (table) => [index("purchases_live").on(table.liveId)],
);
