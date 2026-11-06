import { migrateDatabase } from "../src/db/migrate.js";
import { databaseUrl, resetDatabase } from "./support.js";

/** Base de test : migrations appliquées comme au démarrage du serveur, tables vidées. */
export default async function setup() {
  await migrateDatabase(databaseUrl);
  await resetDatabase();
}
