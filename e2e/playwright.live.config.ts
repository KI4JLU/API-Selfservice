import { defineConfig, devices } from '@playwright/test';
import { loadEnvFile } from './test-env';

// E2E_ENV_FILE=.env.test (pnpm test:e2e:local) runs against the local Docker proxy; without it .env is used
if (process.env.E2E_ENV_FILE) loadEnvFile(process.env.E2E_ENV_FILE);
if (!process.env.LITELLM_BASE_URL) {
  try {
    loadEnvFile('.env');
  } catch {
    // no .env: the global setup reports the missing settings
  }
}
// The suite creates users, teams and keys and sends real requests. A proxy that is not on this machine (e.g. production)
// needs an explicit E2E_ALLOW_REMOTE=1 (pnpm test:e2e:live), so a plain `playwright test` never reaches it by accident.
const litellmHost = (() => {
  try {
    return new URL(process.env.LITELLM_BASE_URL ?? '').hostname;
  } catch {
    return '';
  }
})();
if (litellmHost && !['localhost', '127.0.0.1', '::1'].includes(litellmHost) && process.env.E2E_ALLOW_REMOTE !== '1') {
  throw new Error(`Live suite would run against ${litellmHost}. Use pnpm test:e2e:local, or set E2E_ALLOW_REMOTE=1 (pnpm test:e2e:live) on purpose.`);
}

/**
 * Live suite against a real LiteLLM proxy (docs/plans/e2e_live_litellm_plan.md).
 * Run: pnpm test:e2e:live  (needs `docker compose up -d postgres mailpit`; stop `pnpm dev` first).
 *
 * The servers are always started here (never reused) so the API is guaranteed to run with
 * LITELLM_MODE=http, dev login and SMTP to Mailpit; no mail leaves the machine.
 */
const apiEnv = {
  LITELLM_MODE: 'http',
  DEV_LOGIN_ENABLED: 'true',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  SMTP_USER: '',
  SMTP_PASS: '',
  ADMIN_NOTIFY_EMAILS: 'e2e-live-admins@example.com',
};

export default defineConfig({
  testDir: './live',
  testMatch: '**/*.spec.ts',
  // real requests and LiteLLM spend log batching make single tests slow
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results-live',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'de-DE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'live-api', testDir: './live/api', use: { baseURL: 'http://localhost:3030', extraHTTPHeaders: { Origin: 'http://localhost:5173' } } },
    { name: 'live-ui', testDir: './live/ui', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @api-selfservice/api dev',
      url: 'http://localhost:3030/health',
      reuseExistingServer: false,
      cwd: '..',
      timeout: 90_000,
      env: apiEnv,
    },
    {
      command: 'pnpm --filter @api-selfservice/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      cwd: '..',
      timeout: 90_000,
    },
  ],
  globalSetup: './live/global-setup.ts',
});
