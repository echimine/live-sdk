import { and, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { postgresCode } from "./db/postgres-error.js";
import { chatMessages, products } from "./db/schema.js";
import type { ChatMessage } from "./protocol/index.js";

type Row = typeof chatMessages.$inferSelect;
type ProductRow = typeof products.$inferSelect;
type TextMessage = Extract<ChatMessage, { kind: "text" }>;

/** Message récent du chat ; `hidden` : envoyé en Shadowban, visible de son seul auteur. */
export interface RecentMessage {
  message: ChatMessage;
  hidden: boolean;
}

/** Message tel qu'il part sur le fil ; une Annonce d'achat reprend le produit acheté. */
function toMessage(row: Row, product: ProductRow | null): ChatMessage | undefined {
  const base = {
    id: row.id,
    author: {
      id: row.authorId,
      app: row.authorApp,
      name: row.authorName,
      ...(row.authorPicture !== null && { picture: row.authorPicture }),
    },
    role: row.authorRole,
    at: row.sentAt.toISOString(),
  };
  if (row.kind === "purchase") {
    if (product === null) return undefined;
    const { id, name, price, currency } = product;
    return { ...base, kind: "purchase", product: { id, name, price, currency } };
  }
  return row.text === null ? undefined : { ...base, kind: "text", text: row.text };
}

/**
 * Les erreurs de Drizzle recopient la requête et ses paramètres, donc le texte du
 * message : on n'en garde que le code Postgres, pour qu'aucun texte du chat
 * n'atteigne les logs.
 */
async function withoutChatText<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(`${operation} impossible (code Postgres ${postgresCode(error) ?? "inconnu"})`);
  }
}

/** Historique du chat des Lives, dans Postgres. */
export class ChatStore {
  constructor(private readonly db: PostgresJsDatabase) {}

  /** `hidden` : envoyé en Shadowban, visible de son seul auteur. */
  async insert(liveId: string, message: TextMessage, hidden: boolean): Promise<void> {
    await withoutChatText("écriture du message", () => this.db.insert(chatMessages).values({
      id: message.id,
      liveId,
      authorId: message.author.id,
      authorApp: message.author.app,
      authorName: message.author.name,
      authorPicture: message.author.picture ?? null,
      authorRole: message.role,
      kind: message.kind,
      text: message.text,
      sentAt: new Date(message.at),
      hidden,
    }));
  }

  /** Marque un message de ce Live comme supprimé ; `false` s'il est introuvable ou déjà supprimé. */
  async markDeleted(liveId: string, id: string, at: Date): Promise<boolean> {
    const rows = await withoutChatText("suppression du message", () =>
      this.db
        .update(chatMessages)
        .set({ deletedAt: at })
        .where(and(eq(chatMessages.id, id), eq(chatMessages.liveId, liveId), isNull(chatMessages.deletedAt)))
        .returning({ id: chatMessages.id }),
    );
    return rows.length > 0;
  }

  /**
   * Les `limit` derniers messages non supprimés d'un Live, Annonces d'achat
   * comprises, du plus ancien au plus récent, ceux envoyés en Shadowban compris.
   */
  async recent(liveId: string, limit: number): Promise<RecentMessage[]> {
    const rows = await this.db
      .select({ message: chatMessages, product: products })
      .from(chatMessages)
      .leftJoin(products, eq(chatMessages.productId, products.id))
      .where(and(eq(chatMessages.liveId, liveId), isNull(chatMessages.deletedAt)))
      .orderBy(desc(chatMessages.seq))
      .limit(limit);
    return rows.reverse().flatMap(({ message: row, product }) => {
      const message = toMessage(row, product);
      return message ? [{ message, hidden: row.hidden }] : [];
    });
  }
}
