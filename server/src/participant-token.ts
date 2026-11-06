import { decodeJwt, jwtVerify } from "jose";
import type { MemberApps } from "./member-apps.js";
import { HttpsUrl, Participant } from "./protocol/index.js";

export class InvalidParticipantToken extends Error {}

/**
 * Vérifie un Jeton de Participant (JWT HS256 signé par le backend de l'App
 * d'origine) et en tire le Participant. Le jeton ne porte aucun rôle.
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
      requiredClaims: ["sub", "exp"],
    }));
  } catch {
    throw new InvalidParticipantToken("signature invalide ou jeton expiré");
  }

  const name = Participant.shape.name.safeParse(payload.name);
  if (!name.success) {
    throw new InvalidParticipantToken("`name` absent ou hors 1–30 caractères");
  }
  // Un avatar non https est ignoré sans refuser le jeton : le SDK affiche l'initiale.
  const picture = HttpsUrl.safeParse(payload.picture);

  return {
    id: `${iss as string}:${payload.sub}`,
    app: iss as string,
    name: name.data,
    ...(picture.success && { picture: picture.data }),
  };
}
