import { z } from "zod";

/** Horodatage ISO 8601 en UTC, par exemple `2026-11-06T18:02:11.000Z`. */
export const Timestamp = z.iso.datetime();

/** URL https, seule forme acceptée pour un avatar ou une image. */
export const HttpsUrl = z.url({ protocol: /^https$/ });

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Nombre de caractères visibles (graphèmes) : un emoji composé compte pour un. */
export function graphemeCount(text: string): number {
  let count = 0;
  for (const _ of graphemes.segment(text)) count++;
  return count;
}

/** Pseudo d'un Participant : 1 à 30 caractères visibles, après `trim`. */
export const ParticipantName = z
  .string()
  .trim()
  .refine((name) => {
    const count = graphemeCount(name);
    return count >= 1 && count <= 30;
  }, "1 à 30 caractères visibles");

/**
 * Participant tel qu'il apparaît sur le fil. `id` est opaque et attribué par le
 * serveur commun ; il identifie le couple (App d'origine, identifiant dans l'app).
 */
export const Participant = z.object({
  id: z.string().min(1),
  /** App d'origine : `iss` du Jeton de Participant. */
  app: z.string().min(1),
  name: ParticipantName,
  /** Absent si l'avatar est manquant ou invalide : le SDK affiche l'initiale. */
  picture: HttpsUrl.optional(),
});
export type Participant = z.infer<typeof Participant>;

export const Role = z.enum(["host", "cohost", "viewer"]);
export type Role = z.infer<typeof Role>;

/** Titre facultatif d'un Live. */
export const LiveTitle = z.string().min(1).max(80);

/** Nom d'un Produit épinglé (`config.product.nameMaxLength`). */
export const ProductName = z.string().min(1).max(80);

/** Prix en centimes, entre 0 et 1 000 000. */
export const Price = z.int().min(0).max(1_000_000);

/** Code de devise ISO 4217 en majuscules. */
export const Currency = z.string().regex(/^[A-Z]{3}$/);
