import { defineConfig } from 'drizzle-kit';

const schemaName = process.env.DB_SCHEMA ?? 'litelite';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  schemaFilter: [schemaName],
  migrations: { schema: schemaName, table: '__drizzle_migrations' },
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://litelite:litelite@localhost:5432/litellm' },
});
