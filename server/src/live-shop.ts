import { newMessageId } from "./chat.js";
import type { ChatCommands } from "./live-chat.js";
import type { LiveContext } from "./live-context.js";
import { broadcast, type CommandResult, liveNotFound, type Presence } from "./live-state.js";
import { newProductId, type PurchaseMessage } from "./product-store.js";
import { productInput } from "./shop.js";

const notAnimatorForProduct = {
  ok: false,
  code: "not_animator",
  message: "Seuls les Animateurs peuvent épingler ou retirer un produit.",
} as const;

/** Produit épinglé et Achats d'un Live en cours. */
export class ShopCommands {
  constructor(
    private readonly ctx: LiveContext,
    private readonly chat: ChatCommands,
  ) {}

  /**
   * Un Animateur épingle un produit, à la place du précédent : enregistré, `ack`
   * (via `accepted`), puis `productPinned` à tous. `invalid_product` s'il est invalide.
   */
  async pinProduct(presence: Presence, candidate: unknown, accepted: () => void): Promise<CommandResult> {
    const { ctx } = this;
    if (presence.role === "viewer") return notAnimatorForProduct;
    const state = ctx.runningFor(presence);
    if (!state) return liveNotFound;
    const max = ctx.config.product.nameMaxLength;
    const input = productInput(candidate, max);
    if (!input) {
      return {
        ok: false,
        code: "invalid_product",
        message: `Produit invalide : nom de 1 à ${max} caractères, prix de 0 à 1 000 000 centimes, devise ISO 4217 en majuscules, image en https.`,
      };
    }
    const product = { id: newProductId(), ...input };
    return state.shop.exclusive(async () => {
      await ctx.products.pin(state.live.id, product, ctx.clock.now());
      // Le Live a pu se terminer pendant l'écriture : le produit est conservé, sans diffusion.
      if (!ctx.isRunning(state)) return liveNotFound;
      state.shop.pinned = product;
      accepted();
      broadcast(state, { type: "productPinned", product });
      return { ok: true };
    });
  }

  /** Un Animateur retire le Produit épinglé : `ack`, puis `productUnpinned` à tous s'il y en avait un. */
  async unpinProduct(presence: Presence, accepted: () => void): Promise<CommandResult> {
    const { ctx } = this;
    if (presence.role === "viewer") return notAnimatorForProduct;
    const state = ctx.runningFor(presence);
    if (!state) return liveNotFound;
    return state.shop.exclusive(async () => {
      const unpinned = await ctx.products.unpin(state.live.id, ctx.clock.now());
      if (!ctx.isRunning(state)) return liveNotFound;
      state.shop.pinned = undefined;
      accepted();
      if (unpinned) broadcast(state, { type: "productUnpinned" });
      return { ok: true };
    });
  }

  /**
   * Un Participant achète le Produit épinglé (Achat simulé) : enregistré, `ack`, puis
   * Annonce d'achat dans le chat de tous. `product_changed` si `productId` n'est plus
   * le Produit épinglé ; un Achat par seconde au plus.
   */
  async purchase(presence: Presence, productId: string, accepted: () => void): Promise<CommandResult> {
    const { ctx } = this;
    const state = ctx.runningFor(presence);
    if (!state) return liveNotFound;
    const product = state.shop.pinned;
    if (product?.id !== productId) {
      return { ok: false, code: "product_changed", message: "Le Produit épinglé a changé entre-temps." };
    }
    const buyer = presence.participant.id;
    const at = ctx.clock.now();
    const retryAfterMs = state.shop.takePurchase(buyer, at);
    if (retryAfterMs !== undefined) {
      return { ok: false, code: "rate_limited", message: "Un Achat par seconde au plus.", retryAfterMs };
    }
    const { id, name, price, currency } = product;
    // En Shadowban, l'Achat compte, mais son Annonce n'est visible que de l'acheteur.
    const hidden = state.moderation.isShadowbanned(buyer);
    const message = {
      id: newMessageId(),
      kind: "purchase",
      author: presence.participant,
      role: presence.role,
      product: { id, name, price, currency },
      at: at.toISOString(),
    } satisfies PurchaseMessage;
    try {
      await ctx.products.recordPurchase(state.live.id, message, hidden);
    } catch (error) {
      // Achat perdu : il ne compte pas dans la limite.
      state.shop.giveBackPurchase(buyer, at);
      throw error;
    }
    state.shop.purchases++;
    // Le Live a pu se terminer pendant l'écriture : l'Achat est conservé, sans annonce.
    if (!ctx.isRunning(state)) return liveNotFound;
    this.chat.announce(state, { message, hidden }, accepted);
    return { ok: true };
  }
}
