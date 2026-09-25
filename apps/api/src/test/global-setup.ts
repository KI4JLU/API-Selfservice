/**
 * Runs once in the vitest main process: drops and recreates the test schema and applies migrations.
 * The schema name is rewritten by applyMigrations(), so the dev schema `api_selfservice` is never touched.
 */
const TEST_SCHEMA: string = 'api_selfservice_test';

export default async function globalSetup() {
  process.env.DB_SCHEMA = TEST_SCHEMA;
  process.env.NODE_ENV = 'test';
  const url = process.env.DATABASE_URL ?? 'postgres://api_selfservice:api_selfservice@localhost:5433/litellm';
  process.env.DATABASE_URL = url;
  if (TEST_SCHEMA === 'api_selfservice') throw new Error('refusing to run tests against the dev schema');

  const { createDb, sql } = await import('@api-selfservice/db');
  const { applyMigrations } = await import('@api-selfservice/db/migrate');
  const { db, close } = createDb(url, { max: 2 });
  try {
    // Docker Desktop occasionally resets fresh connections; retry a few times before giving up.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await db.execute(sql.raw('SELECT 1'));
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    if (lastErr) throw lastErr;
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`));
    await applyMigrations(db, TEST_SCHEMA);
  } finally {
    await close();
  }
}
