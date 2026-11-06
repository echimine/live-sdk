import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Migrations SQL générées par drizzle-kit ; chemin valable depuis `src/` comme depuis `dist/`. */
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Applique les migrations en attente, au démarrage du serveur commun. */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end({ timeout: 1 });
  }
}
