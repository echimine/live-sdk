import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Une seule base Postgres partagée : les fichiers de test tournent l'un après l'autre.
    fileParallelism: false,
  },
});
