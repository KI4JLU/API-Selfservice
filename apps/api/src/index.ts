import { loadDotEnv } from './dotenv.js';
loadDotEnv();
import { serve } from '@hono/node-server';
import { createDb } from '@litelite/db';
import { applyMigrations } from '@litelite/db/migrate';
import { seedBase } from '@litelite/db/seed';
import { loadEnv } from './env.js';
import { logger } from './logger.js';
import { createLiteLLM } from './litellm/index.js';
import { createMailer } from './mail/mailer.js';
import { createApp } from './app.js';
import { startJobs } from './jobs/index.js';
import { syncProviders } from './services/providers.js';
import type { Deps } from './context.js';

async function main() {
  const env = loadEnv();
  const { db, close } = createDb(env.DATABASE_URL);
  await applyMigrations(db, env.DB_SCHEMA);
  await seedBase(db);
  const deps: Deps = { env, db, litellm: createLiteLLM(env), mailer: createMailer(env), log: logger, now: () => new Date() };
  const { app } = createApp(deps);

  try {
    const r = await syncProviders(deps, null);
    logger.info(r, 'providers synced');
  } catch (e) {
    logger.warn({ err: e }, 'initial provider sync failed');
  }
  const stopJobs = env.JOBS_ENABLED ? startJobs(deps) : () => {};

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info({ port: info.port, env: env.NODE_ENV, litellm: env.LITELLM_MODE, docs: `${env.API_URL}/api/docs` }, 'LiteLite API listening');
  });
  const shutdown = async () => {
    stopJobs();
    server.close();
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  logger.error({ err: e }, 'startup failed');
  process.exit(1);
});
