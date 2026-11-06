import { drizzle } from "drizzle-orm/postgres-js";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import postgres from "postgres";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ChatStore } from "./chat-store.js";
import { type Clock, systemClock } from "./clock.js";
import { checkHealth } from "./health.js";
import { ImageStore, sniffImageType } from "./images.js";
import { attachLiveSockets } from "./live-socket.js";
import { LiveStore } from "./live-store.js";
import { createLivekitPort, type LivekitPort } from "./livekit.js";
import { Lives } from "./lives.js";
import { loadMemberApps } from "./member-apps.js";
import { ModerationStore } from "./moderation-store.js";
import { ProductStore } from "./product-store.js";
import { Quota } from "./rate-limit.js";
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
  /** Ouvre `GET /admin/state` ; sans lui, la route n'existe pas. */
  ADMIN_TOKEN: z.string().min(16, "16 caractères au moins").optional(),
  /**
   * Nombre de proxys de confiance devant le serveur (Traefik en production : 1).
   * L'IP du client, pour les quotas, est alors lue dans `X-Forwarded-For`.
   */
  TRUST_PROXY: z.string().regex(/^\d$/, "nombre de proxys, de 0 à 9").default("0").transform(Number),
  /** Dossier des images du Produit épinglé (volume en production). */
  IMAGES_DIR: z.string().min(1).default("/data/images"),
  /** Adresse publique du serveur commun, en https : base des URL d'images rendues aux SDK. */
  PUBLIC_URL: z.url({ protocol: /^https$/ }).default("https://live.echimine.fr"),
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
  /** Journal JSON de Fastify (`true`), ou ses options (flux de sortie en test). Jetons et texte du chat masqués. */
  logger?: FastifyServerOptions["logger"];
}

/**
 * Champs jamais écrits dans les logs, au cas où ils y passeraient : jetons
 * (Participant, admin, LiveKit) et texte du chat. Les en-têtes ne sont de toute
 * façon pas journalisés par Fastify.
 */
const redactedLogPaths = [
  "req.headers.authorization",
  "headers.authorization",
  "token",
  "*.token",
  "text",
  "*.text",
];

declare module "fastify" {
  interface FastifyRequest {
    participant: Participant;
  }
}

function sendError(reply: FastifyReply, status: number, error: z.infer<typeof HttpError>["error"]) {
  return reply.code(status).send({ error } satisfies z.infer<typeof HttpError>);
}

/** Quota dépassé : `429`, en-tête `Retry-After` en secondes. */
function sendRateLimited(reply: FastifyReply, retryAfterMs: number) {
  reply.header("retry-after", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return sendError(reply, 429, { code: "rate_limited", message: "Trop de requêtes, réessayez plus tard." });
}

/** Garde de route : un jeton de `limiter` par requête, pour la clé donnée. */
function quota(limit: Quota, keyOf: (request: FastifyRequest) => string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const retryAfterMs = limit.take(keyOf(request));
    if (retryAfterMs !== undefined) return sendRateLimited(reply, retryAfterMs);
  };
}

/** Comparaison à temps constant, longueurs comprises (via empreinte). */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
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
  const images = new ImageStore(env.IMAGES_DIR, env.PUBLIC_URL);

  const logger = options.logger ?? false;
  const server = Fastify({
    logger: logger && {
      ...(typeof logger === "object" && logger),
      redact: { paths: redactedLogPaths, censor: "[masqué]" },
    },
    // Le socket (rang 0) et les `TRUST_PROXY - 1` derniers relais de `X-Forwarded-For` sont de confiance.
    ...(env.TRUST_PROXY > 0 && { trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY }),
  });
  const quotas = {
    launch: new Quota(5, 60_000, clock),
    imageUpload: new Quota(10, 60_000, clock),
    publicGet: new Quota(60, 60_000, clock),
  };
  const byParticipant = (request: FastifyRequest) => request.participant.id;

  // Connexion paresseuse : le serveur démarre même si Postgres est KO, et `/health` le dit.
  const sql = postgres(env.DATABASE_URL, { max: 5, connect_timeout: 2, onnotice: () => {} });
  server.addHook("onClose", () => sql.end({ timeout: 1 }));
  const db = drizzle(sql);
  const lives = new Lives({
    store: new LiveStore(db),
    chat: new ChatStore(db),
    products: new ProductStore(db),
    moderation: new ModerationStore(db),
    livekit,
    clock,
    log: server.log,
    config: config.config,
  });
  // Enregistré avant les sockets : leur fermeture ne relance aucun minuteur.
  server.addHook("preClose", async () => lives.stop());
  attachLiveSockets(server, { lives, memberApps, clock, trustProxy: env.TRUST_PROXY });
  // Redémarrage en plein Live : les Lives en cours reprennent. Postgres KO ne bloque pas le démarrage.
  server.addHook("onReady", async () => {
    try {
      await lives.resume();
    } catch (error) {
      server.log.error({ err: error }, "reprise des Lives en cours impossible");
    }
  });

  // `GET` publics (`/v1/…`) : par IP, avant toute authentification. `/health` et
  // `/admin/state` restent joignables même quand l'IP de la salle est saturée. Les
  // images, fichiers immuables que chaque téléphone de la salle charge, n'y comptent pas.
  const publicGetQuota = quota(quotas.publicGet, (request) => request.ip);
  server.addHook("onRequest", async (request, reply) => {
    const isGet = request.method === "GET" || request.method === "HEAD";
    if (isGet && request.url.startsWith("/v1/") && !request.url.startsWith("/v1/images/")) {
      return publicGetQuota(request, reply);
    }
  });

  server.get("/health", async (_request, reply) => {
    const health = await checkHealth(sql, env.LIVEKIT_URL);
    return reply.code(health.status === "ok" ? 200 : 503).send(health);
  });

  const startedAt = now();
  const adminToken = env.ADMIN_TOKEN;
  if (adminToken !== undefined) {
    server.get("/admin/state", async (request, reply) => {
      const given = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1];
      if (given === undefined || !sameSecret(given, adminToken)) {
        return sendError(reply, 401, { code: "invalid_token", message: "Jeton d'admin refusé." });
      }
      const liveStates = await lives.adminState();
      return {
        now: now().toISOString(),
        uptimeSeconds: Math.floor((now().getTime() - startedAt.getTime()) / 1000),
        connections: liveStates.reduce((total, live) => total + live.connections, 0),
        lives: liveStates,
      };
    });
  }

  // Corps illisible (JSON invalide…) ou trop gros : erreur au format du contrat. Les autres statuts restent ceux de Fastify.
  server.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    if (error.statusCode === 400) {
      return sendError(reply, 400, { code: "invalid_request", message: "Requête invalide." });
    }
    if (error.statusCode === 413) {
      const megabytes = Math.floor(config.config.images.maxBytes / (1024 * 1024));
      const message = request.url.startsWith("/v1/images") ? `Image de plus de ${megabytes} Mo.` : "Corps trop volumineux.";
      return sendError(reply, 413, { code: "payload_too_large", message });
    }
    throw error;
  });

  // Images du Produit épinglé : publiques, les SDK les affichent sans jeton.
  server.get<{ Params: { name: string } }>("/v1/images/:name", async (request, reply) => {
    const image = await images.open(request.params.name);
    if (!image) return notFound(request, reply);
    return reply
      .type(image.type)
      .header("content-length", image.size)
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .send(image.stream);
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

    // Récapitulatif d'un Live terminé, pour son Hôte seul : `404` pour tout autre cas, sans en dire plus.
    v1.get<{ Params: { id: string } }>("/lives/:id/summary", async (request, reply) => {
      const summary = await lives.summary(request.params.id, request.participant);
      return summary ?? notFound(request, reply);
    });

    v1.post("/lives", { preHandler: quota(quotas.launch, byParticipant) }, async (request, reply) => {
      const body = LivesCreateRequest.safeParse(request.body ?? {});
      if (!body.success) {
        return sendError(reply, 400, { code: "invalid_request", message: "Titre invalide (1 à 80 caractères)." });
      }
      const { live, created } = await lives.launch(request.participant, body.data.title);
      return reply.code(created ? 201 : 200).send({ live: lives.summarize(live) });
    });

    // Image du Produit épinglé, en corps binaire : le format est lu sur ses premiers octets.
    v1.register(async (upload) => {
      upload.removeAllContentTypeParsers();
      upload.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
      upload.post(
        "/images",
        // Quota vérifié avant de recevoir le corps (jusqu'à 10 Mo).
        { onRequest: quota(quotas.imageUpload, byParticipant), bodyLimit: config.config.images.maxBytes },
        async (request, reply) => {
          const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
          const type = sniffImageType(bytes);
          if (type === undefined || !config.config.images.formats.includes(type)) {
            const formats = config.config.images.formats.join(", ");
            return sendError(reply, 415, { code: "unsupported_media_type", message: `Formats acceptés : ${formats}.` });
          }
          return reply.code(201).send({ url: await images.save(bytes, type) });
        },
      );
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
