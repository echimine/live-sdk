import { migrateDatabase } from "./db/migrate.js";
import { createServer } from "./server.js";

function readPort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT invalide : ${value}`);
  }
  return port;
}

const port = readPort(process.env.PORT);
const host = process.env.HOST || "0.0.0.0";

// Config invalide → le serveur refuse de démarrer (l'erreur sort en code 1).
const server = await createServer({ env: process.env, logger: true });

// Migrations avant d'écouter : Postgres doit répondre (compose : `depends_on` sain).
await migrateDatabase(process.env.DATABASE_URL!);

try {
  await server.listen({ port, host });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
