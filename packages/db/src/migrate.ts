import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { createDb, SCHEMA_NAME, type Db } from './index.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');
const GENERATED_SCHEMA = 'api_selfservice';

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

/**
 * Minimal migrator that rewrites the schema name so the same migration files
 * can be applied to any schema (dev/staging/prod share a DB host).
 */
export async function runMigrations(connectionString: string, schemaName = SCHEMA_NAME) {
  const { db, close } = createDb(connectionString, { max: 2 });
  try {
    await applyMigrations(db, schemaName);
  } finally {
    await close();
  }
}

export async function applyMigrations(db: Db, schemaName = SCHEMA_NAME) {
  const q = (s: string) => `"${s}"`;
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${q(schemaName)}`));
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS ${q(schemaName)}.__migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`));
  const journal = JSON.parse(await readFile(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  const applied = new Set((await db.execute(sql.raw(`SELECT tag FROM ${q(schemaName)}.__migrations`))).rows.map((r) => (r as { tag: string }).tag));
  for (const entry of journal.entries.sort((a, b) => a.idx - b.idx)) {
    if (applied.has(entry.tag)) continue;
    let content = await readFile(path.join(migrationsFolder, `${entry.tag}.sql`), 'utf8');
    if (schemaName !== GENERATED_SCHEMA) {
      content = content.replaceAll(`"${GENERATED_SCHEMA}".`, `${q(schemaName)}.`).replaceAll(`SCHEMA "${GENERATED_SCHEMA}"`, `SCHEMA ${q(schemaName)}`);
    }
    content = content.replace(/CREATE SCHEMA "([^"]+)";/g, 'CREATE SCHEMA IF NOT EXISTS "$1";');
    const statements = content
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    await db.transaction(async (tx) => {
      for (const st of statements) await tx.execute(sql.raw(st));
      await tx.execute(sql.raw(`INSERT INTO ${q(schemaName)}.__migrations (tag) VALUES ('${entry.tag}')`));
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  runMigrations(url)
    .then(() => {
      console.log(`migrations applied to schema ${SCHEMA_NAME}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
