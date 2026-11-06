import { opaqueId } from "./ids.js";

/** Identifiant opaque d'un message du chat : `msg_` + 16 caractères. */
export function newMessageId(): string {
  return opaqueId("msg_", 16);
}

const graphemes = new Intl.Segmenter("fr", { granularity: "grapheme" });

/** Graphème sans rien de visible : uniquement des caractères de format (espace de largeur nulle, marques bidi…). */
const INVISIBLE = /^\p{Cf}+$/u;
/** Graphème qui affiche quelque chose. */
const VISIBLE = /[^\p{Cf}\p{White_Space}]/u;

/**
 * Texte d'un message prêt à diffuser : sans espaces autour, de 1 à `maxLength`
 * caractères visibles (graphèmes : un emoji composé compte pour un, un caractère
 * de format ne compte pas), avec au moins un caractère qui s'affiche. `undefined` sinon.
 */
export function chatText(text: string, maxLength: number): string | undefined {
  const trimmed = text.trim();
  let length = 0;
  let showsSomething = false;
  for (const { segment } of graphemes.segment(trimmed)) {
    if (INVISIBLE.test(segment)) continue;
    if (++length > maxLength) return undefined;
    showsSomething ||= VISIBLE.test(segment);
  }
  return showsSomething ? trimmed : undefined;
}
