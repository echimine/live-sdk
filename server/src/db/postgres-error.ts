/** Code d'erreur Postgres (`23505`…) d'une erreur levée par postgres.js, directement ou via Drizzle. */
export function postgresCode(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
