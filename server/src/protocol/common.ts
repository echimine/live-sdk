import { z } from "zod";

/** Horodatage ISO 8601 en UTC, par exemple `2026-11-06T18:02:11.000Z`. */
export const Timestamp = z.iso.datetime();

/** URL https, seule forme acceptée pour un avatar ou une image. */
export const HttpsUrl = z.url({ protocol: /^https$/ });

const graphemes = new Intl.Segmenter("fr", { granularity: "grapheme" });

/** Graphème sans rien de visible : uniquement des caractères de format (espace de largeur nulle, marques bidi…). */
const INVISIBLE = /^\p{Cf}+$/u;
/** Graphème qui affiche quelque chose. */
const VISIBLE = /[^\p{Cf}\p{White_Space}]/u;

/**
 * Texte prêt à partir sur le fil (pseudo, titre, message du chat, nom de
 * produit) : sans espaces autour, de 1 à `max` caractères visibles (graphèmes :
 * un emoji composé compte pour un, un caractère de format ne compte pas), avec
 * au moins un caractère qui s'affiche. `undefined` sinon.
 */
export function visibleText(text: string, max: number): string | undefined {
  const trimmed = text.trim();
  let length = 0;
  let showsSomething = false;
  for (const { segment } of graphemes.segment(trimmed)) {
    if (INVISIBLE.test(segment)) continue;
    if (++length > max) return undefined;
    showsSomething ||= VISIBLE.test(segment);
  }
  return showsSomething ? trimmed : undefined;
}

/** Schéma d'un texte de 1 à `max` caractères visibles, après `trim`. */
function visibleTextSchema(max: number) {
  return z
    .string()
    .trim()
    .refine((text) => visibleText(text, max) !== undefined, `1 à ${max} caractères visibles`);
}

/** Pseudo d'un Participant : 1 à 30 caractères visibles, après `trim`. */
export const ParticipantName = visibleTextSchema(30);

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

/** Titre facultatif d'un Live : 1 à 80 caractères visibles, après `trim`. */
export const LiveTitle = visibleTextSchema(80);

/** Nom d'un Produit épinglé : sa longueur maximale vient de `config.product.nameMaxLength`, vérifiée par le serveur. */
export const ProductName = z.string().min(1);

/** Prix en centimes, entre 0 et 1 000 000. */
export const Price = z.int().min(0).max(1_000_000);

/** Code de devise ISO 4217 en majuscules. */
export const Currency = z.string().regex(/^[A-Z]{3}$/);

/** Récapitulatif de fin d'un Live, pour son Hôte seul (`liveEnded` et `GET /v1/lives/{id}/summary`). */
export const EndSummary = z.object({
  purchases: z.int().min(0),
  reactions: z.int().min(0),
  peakAudience: z.int().min(0),
});
export type EndSummary = z.infer<typeof EndSummary>;
