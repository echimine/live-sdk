import { opaqueId } from "./ids.js";

/** Identifiant opaque d'un message du chat : `msg_` + 16 caractères. */
export function newMessageId(): string {
  return opaqueId("msg_", 16);
}
