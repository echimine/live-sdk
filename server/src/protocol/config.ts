import { z } from "zod";

/** Config servie par `GET /v1/config` ; la fixture sert de valeurs par défaut aux SDK. */
export const Config = z.object({
  /** De 4 à 16 emojis ; le premier est la Réaction rapide. */
  reactions: z.array(z.string().min(1)).min(4).max(16),
  chat: z.object({
    maxLength: z.int().positive(),
  }),
  images: z.object({
    maxBytes: z.int().positive(),
    formats: z.array(z.string().min(1)).min(1),
  }),
  product: z.object({
    nameMaxLength: z.int().positive(),
  }),
});
export type Config = z.infer<typeof Config>;
