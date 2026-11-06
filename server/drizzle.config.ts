import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` : génère la migration SQL de `drizzle/` à partir du schéma.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
