import { randomBytes } from "node:crypto";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Identifiant opaque : `prefix` suivi de `length` caractères aléatoires `[a-z0-9]`. */
export function opaqueId(prefix: string, length: number): string {
  return `${prefix}${[...randomBytes(length)].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("")}`;
}
