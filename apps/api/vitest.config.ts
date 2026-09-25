import { defineConfig } from 'vitest/config';

const TEST_SCHEMA = 'api_selfservice_test';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Process env for the workers. DB_SCHEMA must be set before @api-selfservice/db is imported
    // (pgSchema(SCHEMA_NAME) is evaluated at import time).
    env: {
      NODE_ENV: 'test',
      DB_SCHEMA: TEST_SCHEMA,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://api_selfservice:api_selfservice@localhost:5433/litellm',
      LOG_LEVEL: 'silent',
    },
    globalSetup: ['./src/test/global-setup.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // Integration tests share one Postgres schema: run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
