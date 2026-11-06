import { and, count, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { chatMessages, products, purchases } from "./db/schema.js";
import { opaqueId } from "./ids.js";
import type { ChatMessage, Product } from "./protocol/index.js";

/** Annonce d'achat : le message du chat qui accompagne chaque Achat. */
export type PurchaseMessage = Extract<ChatMessage, { kind: "purchase" }>;

/** Identifiant opaque d'un produit épinglé : `prd_` + 12 caractères. */
export function newProductId(): string {
  return opaqueId("prd_", 12);
}

/** Produits épinglés et Achats des Lives, dans Postgres. */
export class ProductStore {
  constructor(private readonly db: PostgresJsDatabase) {}

  /** Le Produit épinglé de ce Live, s'il y en a un. */
  async findPinned(liveId: string): Promise<Product | undefined> {
    const [row] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.liveId, liveId), isNull(products.unpinnedAt)));
    return (
      row && {
        id: row.id,
        name: row.name,
        price: row.price,
        currency: row.currency,
        ...(row.imageUrl !== null && { imageUrl: row.imageUrl }),
      }
    );
  }

  /** Épingle ce produit à la place du précédent, s'il y en avait un. */
  async pin(liveId: string, product: Product, at: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(products).set({ unpinnedAt: at }).where(and(eq(products.liveId, liveId), isNull(products.unpinnedAt)));
      await tx.insert(products).values({
        id: product.id,
        liveId,
        name: product.name,
        price: product.price,
        currency: product.currency,
        imageUrl: product.imageUrl ?? null,
        pinnedAt: at,
      });
    });
  }

  /** Retire le Produit épinglé de ce Live ; `false` s'il n'y en avait pas. */
  async unpin(liveId: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(products)
      .set({ unpinnedAt: at })
      .where(and(eq(products.liveId, liveId), isNull(products.unpinnedAt)))
      .returning({ id: products.id });
    return rows.length > 0;
  }

  async countPurchases(liveId: string): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(purchases).where(eq(purchases.liveId, liveId));
    return row?.total ?? 0;
  }

  /**
   * Enregistre un Achat et son Annonce d'achat dans l'historique du chat, ensemble ;
   * `hidden` : Annonce faite en Shadowban, visible du seul acheteur.
   */
  async recordPurchase(liveId: string, message: PurchaseMessage, hidden: boolean): Promise<void> {
    const { author, role, product } = message;
    const at = new Date(message.at);
    await this.db.transaction(async (tx) => {
      await tx.insert(purchases).values({
        id: message.id,
        liveId,
        productId: product.id,
        buyerId: author.id,
        buyerApp: author.app,
        buyerName: author.name,
        buyerPicture: author.picture ?? null,
        buyerRole: role,
        purchasedAt: at,
      });
      await tx.insert(chatMessages).values({
        id: message.id,
        liveId,
        authorId: author.id,
        authorApp: author.app,
        authorName: author.name,
        authorPicture: author.picture ?? null,
        authorRole: role,
        kind: "purchase",
        productId: product.id,
        sentAt: at,
        hidden,
      });
    });
  }
}
