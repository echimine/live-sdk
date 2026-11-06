import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import postgres from "postgres";
import { z } from "zod";
import { checkHealth } from "./health.js";
import { loadMemberApps } from "./member-apps.js";
import { InvalidParticipantToken, verifyParticipantToken } from "./participant-token.js";
import type { HttpError, Participant } from "./protocol/index.js";
import { defaultConfigFile, loadServedConfig, matchesETag } from "./served-config.js";

/** Variables d'environnement lues par le serveur commun (hors `PORT` / `HOST`, lus par `main.ts`). */
const ServerEnv = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  MEMBER_APPS_FILE: z.string().min(1),
  /** Facultatif : sondé par `/health` à titre informatif. */
  LIVEKIT_URL: z.url({ protocol: /^(wss?|https?)$/ }).optional(),
});
export type ServerEnv = z.input<typeof ServerEnv>;

export interface CreateServerOptions {
  env: Record<string, string | undefined>;
  /** Horloge injectable (expiration des jetons). */
  now?: () => Date;
  /** Config servie ; par défaut la fixture du contrat. */
  configFile?: string;
  logger?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    participant: Participant;
  }
}

function sendError(reply: FastifyReply, status: number, error: z.infer<typeof HttpError>["error"]) {
  return reply.code(status).send({ error } satisfies z.infer<typeof HttpError>);
}

/**
 * Construit le serveur commun à partir de l'environnement. Rejette si la config
 * est invalide : le serveur refuse alors de démarrer.
 */
export async function createServer(options: CreateServerOptions): Promise<FastifyInstance> {
  // Une variable vide (`LIVEKIT_URL=` dans un `.env`) vaut absente.
  const definedEnv = Object.fromEntries(Object.entries(options.env).filter(([, value]) => value !== ""));
  const parsedEnv = ServerEnv.safeParse(definedEnv);
  if (!parsedEnv.success) {
    throw new Error(`Environnement invalide : ${z.prettifyError(parsedEnv.error)}`);
  }
  const env = parsedEnv.data;
  const now = options.now ?? (() => new Date());
  const memberApps = loadMemberApps(env.MEMBER_APPS_FILE);
  const config = loadServedConfig(options.configFile ?? defaultConfigFile);

  const server = Fastify({ logger: options.logger ?? false });

  // Connexion paresseuse : le serveur démarre même si Postgres est KO, et `/health` le dit.
  const sql = postgres(env.DATABASE_URL, { max: 5, connect_timeout: 2, onnotice: () => {} });
  server.addHook("onClose", () => sql.end({ timeout: 1 }));

  server.get("/health", async (_request, reply) => {
    const health = await checkHealth(sql, env.LIVEKIT_URL);
    return reply.code(health.status === "ok" ? 200 : 503).send(health);
  });

  server.setNotFoundHandler((_request, reply) =>
    sendError(reply, 404, { code: "not_found", message: "Ressource introuvable." }),
  );

  async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "");
    if (!match?.[1]) {
      return sendError(reply, 401, { code: "invalid_token", message: "Jeton de Participant manquant." });
    }
    try {
      request.participant = await verifyParticipantToken(match[1], memberApps, now());
    } catch (error) {
      if (!(error instanceof InvalidParticipantToken)) throw error;
      return sendError(reply, 401, { code: "invalid_token", message: "Jeton de Participant refusé." });
    }
  }

  server.register(async (v1) => {
    v1.decorateRequest("participant", null as unknown as Participant);
    v1.addHook("onRequest", authenticate);

    // Provisoire : aucun Live n'existe tant que le lancement (S2) n'est pas fait.
    v1.get("/lives", async () => ({ lives: [] }));

    v1.get("/config", async (request, reply) => {
      reply.header("etag", config.etag);
      if (matchesETag(request.headers["if-none-match"], config.etag)) {
        return reply.code(304).send();
      }
      return reply.type("application/json; charset=utf-8").send(config.body);
    });
  }, { prefix: "/v1" });

  return server;
}
