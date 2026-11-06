import { SlidingWindow } from "./rate-limit.js";
import { Product, visibleText } from "./protocol/index.js";

/** Un Achat par seconde au plus, par Participant. */
export const PURCHASE_INTERVAL_MS = 1_000;

/** Produit tel qu'un Animateur l'épingle : tout sauf l'identifiant, attribué par le serveur. */
const ProductInput = Product.omit({ id: true });
export type ProductInput = Omit<Product, "id">;

/**
 * Produit valide d'après une commande `pinProduct` (champs inconnus ignorés), ou
 * `undefined` : nom de 1 à `nameMaxLength` caractères visibles (après `trim`,
 * comme un message du chat), prix de 0 à 1 000 000 centimes, devise ISO 4217 en
 * majuscules, image facultative en https.
 */
export function productInput(candidate: unknown, nameMaxLength: number): ProductInput | undefined {
  const parsed = ProductInput.safeParse(candidate);
  if (!parsed.success) return undefined;
  const name = visibleText(parsed.data.name, nameMaxLength);
  if (name === undefined) return undefined;
  const { price, currency, imageUrl } = parsed.data;
  return { name, price, currency, ...(imageUrl !== undefined && { imageUrl }) };
}

/** Produit épinglé et Achats d'un Live en cours. */
export class LiveShop {
  /** Achats par Participant sur la dernière seconde (en mémoire). */
  private readonly window = new SlidingWindow(PURCHASE_INTERVAL_MS);
  /** Changements du Produit épinglé, exécutés l'un après l'autre. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * `pinned` : Produit épinglé enregistré ; `purchases` : Achats déjà enregistrés
   * pour ce Live (rechargés au redémarrage, pour le récapitulatif).
   */
  constructor(
    public pinned: Product | undefined,
    public purchases: number,
  ) {}

  /**
   * Exécute un changement du Produit épinglé après les précédents : la base, la
   * mémoire et l'ordre des diffusions restent d'accord.
   */
  exclusive<T>(change: () => Promise<T>): Promise<T> {
    const result = this.queue.then(change, change);
    this.queue = result.catch(() => {});
    return result;
  }

  /** Compte un Achat de ce Participant et rend `undefined`, ou le délai avant de réessayer (ms). */
  takePurchase(participantId: string, now: Date): number | undefined {
    return this.window.take(participantId, 1, now);
  }

  /** Rend l'Achat compté à `now` (son enregistrement a échoué). */
  giveBackPurchase(participantId: string, now: Date): void {
    this.window.giveBack(participantId, now);
  }
}
