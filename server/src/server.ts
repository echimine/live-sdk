import { drizzle } from "drizzle-orm/postgres-js";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import postgres from "postgres";
import { z } from "zod";
import { type Clock, systemClock } from "./clock.js";
import { checkHealth } from "./health.js";
import { attachLiveSockets } from "./live-socket.js";
import { LiveStore } from "./live-store.js";
import { createLivekitPort, type LivekitPort } from "./livekit.js";
import { Lives } from "./lives.js";
import { loadMemberApps } from "./member-apps.js";
import { InvalidParticipantToken, verifyParticipantToken } from "./participant-token.js";
import { type HttpError, LivesCreateRequest, type Participant } from "./protocol/index.js";
import { defaultConfigFile, loadServedConfig, matchesETag } from "./served-config.js";

/** Variables d'environnement lues par le serveur commun (hors `PORT` / `HOST`, lus par `main.ts`). */
const ServerEnv = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  MEMBER_APPS_FILE: z.string().min(1),
  /** Adresse de LiveKit, pour son API serveur comme pour le signal des SDK ; sondée par `/health`. */
  LIVEKIT_URL: z.url({ protocol: /^(wss?|https?)$/ }).optional(),
  LIVEKIT_API_KEY: z.string().min(1).optional(),
  LIVEKIT_API_SECRET: z.string().min(1).optional(),
});
export type ServerEnv = z.input<typeof ServerEnv>;

export interface CreateServerOptions {
  env: Record<string, string | undefined>;
  /** Horloge injectable : expiration des jetons, délais et cadences. */
  clock?: Clock;
  /** Port LiveKit ; par défaut le vrai, construit depuis `LIVEKIT_*`. */
  livekit?: LivekitPort;
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

function livekitFromEnv(env: z.infer<typeof ServerEnv>): LivekitPort {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = env;
  if (url === undefined || apiKey === undefined || apiSecret === undefined) {
    throw new Error("Environnement invalide : LIVEKIT_URL, LIVEKIT_API_KEY et LIVEKIT_API_SECRET sont requis.");
  }
  return createLivekitPort({ url, apiKey, apiSecret });
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
  const clock = options.clock ?? systemClock;
  const now = () => clock.now();
  const livekit = options.livekit ?? livekitFromEnv(env);
  const memberApps = loadMemberApps(env.MEMBER_APPS_FILE);
  const config = loadServedConfig(options.configFile ?? defaultConfigFile);

  const server = Fastify({ logger: options.logger ?? false });

  // Connexion paresseuse : le serveur démarre même si Postgres est KO, et `/health` le dit.
  const sql = postgres(env.DATABASE_URL, { max: 5, connect_timeout: 2, onnotice: () => {} });
  server.addHook("onClose", () => sql.end({ timeout: 1 }));
  const lives = new Lives(new LiveStore(drizzle(sql)), livekit, clock, server.log);
  // Enregistré avant les sockets : leur fermeture ne relance aucun minuteur.
  server.addHook("preClose", async () => lives.stop());
  attachLiveSockets(server, { lives, memberApps, clock });
  // Redémarrage en plein Live : les Lives en cours reprennent. Postgres KO ne bloque pas le démarrage.
  server.addHook("onReady", async () => {
    try {
      await lives.resume();
    } catch (error) {
      server.log.error({ err: error }, "reprise des Lives en cours impossible");
    }
  });

  server.get("/health", async (_request, reply) => {
    const health = await checkHealth(sql, env.LIVEKIT_URL);
    return reply.code(health.status === "ok" ? 200 : 503).send(health);
  });

  // Corps illisible (JSON invalide…) : erreur au format du contrat. Les autres statuts restent ceux de Fastify.
  server.setErrorHandler((error: { statusCode?: number }, _request, reply) => {
    if (error.statusCode === 400) {
      return sendError(reply, 400, { code: "invalid_request", message: "Requête invalide." });
    }
    throw error;
  });

  const notFound = (_request: FastifyRequest, reply: FastifyReply) =>
    sendError(reply, 404, { code: "not_found", message: "Ressource introuvable." });
  server.setNotFoundHandler(notFound);

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
    // Les hooks `onRequest` ne couvrent pas les routes inconnues : sans jeton valide, 401 avant le 404.
    v1.setNotFoundHandler({ preHandler: authenticate }, notFound);

    v1.get("/lives", async () => ({ lives: await lives.list() }));

    v1.post("/lives", async (request, reply) => {
      const body = LivesCreateRequest.safeParse(request.body ?? {});
      if (!body.success) {
        return sendError(reply, 400, { code: "invalid_request", message: "Titre invalide (1 à 80 caractères)." });
      }
      const { live, created } = await lives.launch(request.participant, body.data.title);
      return reply.code(created ? 201 : 200).send({ live: lives.summarize(live) });
    });

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
