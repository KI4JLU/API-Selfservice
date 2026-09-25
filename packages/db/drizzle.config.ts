import { defineConfig } from 'drizzle-kit';

const schemaName = process.env.DB_SCHEMA ?? 'api_selfservice';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  schemaFilter: [schemaName],
  migrations: { schema: schemaName, table: '__drizzle_migrations' },
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://api_selfservice:api_selfservice@localhost:5432/litellm' },
});
