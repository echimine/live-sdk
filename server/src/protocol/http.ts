import { z } from "zod";
import { HttpsUrl, LiveTitle, Participant, Timestamp } from "./common.js";

/** Un Live en cours, tel que listé par `GET /v1/lives`. */
export const LiveSummary = z.object({
  id: z.string().min(1),
  title: LiveTitle.optional(),
  host: Participant,
  /** Audience totale (Animateurs exclus). */
  audience: z.int().min(0),
  startedAt: Timestamp,
});
export type LiveSummary = z.infer<typeof LiveSummary>;

/** `GET /v1/lives` : Lives en cours, triés par Audience décroissante. */
export const LivesListResponse = z.object({
  lives: z.array(LiveSummary),
});

/** `POST /v1/lives` : lancement idempotent, un Live en cours par Hôte. */
export const LivesCreateRequest = z.object({
  title: LiveTitle.optional(),
});

export const LivesCreateResponse = z.object({
  live: LiveSummary,
});

/** `POST /v1/images` : URL de l'image enregistrée, à passer à `pinProduct`. */
export const ImagesUploadResponse = z.object({
  url: HttpsUrl,
});

export const HttpErrorCode = z.enum([
  "invalid_request",
  "invalid_token",
  "not_found",
  /** Accompagné de l'en-tête `Retry-After`. */
  "rate_limited",
  /** `413` : image au-delà de `images.maxBytes`. */
  "payload_too_large",
  /** `415` : image hors de `images.formats`. */
  "unsupported_media_type",
]);

/** Corps de toute réponse HTTP en erreur. */
export const HttpError = z.object({
  error: z.object({
    code: HttpErrorCode,
    message: z.string(),
  }),
});

/** Messages HTTP, indexés par le nom de leur fixture dans `protocol/fixtures/http/`. */
export const httpMessages = {
  "lives.list.response": LivesListResponse,
  "lives.create.request": LivesCreateRequest,
  "lives.create.response": LivesCreateResponse,
  "images.upload.response": ImagesUploadResponse,
  error: HttpError,
} as const;
