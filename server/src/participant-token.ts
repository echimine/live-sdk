import { decodeJwt, jwtVerify } from "jose";
import { z } from "zod";
import type { MemberApps } from "./member-apps.js";
import { HttpsUrl, Participant, ParticipantName } from "./protocol/index.js";

export class InvalidParticipantToken extends Error {}

/** Identifiant de l'utilisateur dans son App d'origine. */
const Subject = z.string().min(1).max(128);

/** Durée de vie maximale d'un Jeton de Participant, depuis son émission (`iat`). */
export const MAX_TOKEN_AGE = "5m";

/**
 * Vérifie un Jeton de Participant (JWT HS256 signé par le backend de l'App
 * d'origine) et en tire le Participant. Le jeton ne porte aucun rôle et ne vaut
 * que 5 min après son émission, quelle que soit son `exp`.
 */
export async function verifyParticipantToken(
  token: string,
  memberApps: MemberApps,
  now: Date,
): Promise<Participant> {
  let iss: unknown;
  try {
    iss = decodeJwt(token).iss;
  } catch {
    throw new InvalidParticipantToken("jeton illisible");
  }
  const secret = typeof iss === "string" ? memberApps.get(iss) : undefined;
  if (iss === undefined || secret === undefined) {
    throw new InvalidParticipantToken("émetteur inconnu");
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: iss as string,
      currentDate: now,
      maxTokenAge: MAX_TOKEN_AGE,
      requiredClaims: ["sub", "iat", "exp"],
    }));
  } catch {
    throw new InvalidParticipantToken("signature invalide, jeton expiré ou émis depuis plus de 5 min");
  }

  const sub = Subject.safeParse(payload.sub);
  if (!sub.success) {
    throw new InvalidParticipantToken("`sub` vide ou de plus de 128 caractères");
  }
  const name = ParticipantName.safeParse(payload.name);
  if (!name.success) {
    throw new InvalidParticipantToken("`name` absent ou hors 1–30 caractères visibles");
  }
  // Un avatar non https est ignoré sans refuser le jeton : le SDK affiche l'initiale.
  const picture = HttpsUrl.safeParse(payload.picture);

  return {
    id: `${iss as string}:${sub.data}`,
    app: iss as string,
    name: name.data,
    ...(picture.success && { picture: picture.data }),
  };
}
