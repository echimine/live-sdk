import { and, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { postgresCode } from "./db/postgres-error.js";
import { chatMessages } from "./db/schema.js";
import type { ChatMessage } from "./protocol/index.js";

type Row = typeof chatMessages.$inferSelect;
type TextMessage = Extract<ChatMessage, { kind: "text" }>;

function toMessage(row: Row): TextMessage {
  return {
    id: row.id,
    kind: row.kind,
    author: {
      id: row.authorId,
      app: row.authorApp,
      name: row.authorName,
      ...(row.authorPicture !== null && { picture: row.authorPicture }),
    },
    role: row.authorRole,
    text: row.text,
    at: row.sentAt.toISOString(),
  };
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

  async insert(liveId: string, message: TextMessage): Promise<void> {
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

  /** Les `limit` derniers messages non supprimés d'un Live, du plus ancien au plus récent. */
  async recent(liveId: string, limit: number): Promise<TextMessage[]> {
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.liveId, liveId), isNull(chatMessages.deletedAt)))
      .orderBy(desc(chatMessages.seq))
      .limit(limit);
    return rows.reverse().map(toMessage);
  }
}
