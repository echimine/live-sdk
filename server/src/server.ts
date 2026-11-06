import Fastify, { type FastifyInstance } from "fastify";

export interface ServerOptions {
  logger?: boolean;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });

  server.get("/health", async () => ({ status: "ok" }));

  return server;
}
