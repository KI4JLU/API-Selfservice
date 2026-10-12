import { defineConfig, devices } from '@playwright/test';
import { loadEnvFile } from './test-env';

// local test settings (Mailpit, dev login); the API always runs against the LiteLLM mock in its own schema
loadEnvFile('.env.test');

/**
 * Playwright config for API-Selfservice (UI tests in e2e/ui, API tests in e2e/api).
 * Run: pnpm exec playwright test -c e2e/playwright.config.ts e2e/ui
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'de-DE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // API tests (Playwright `request` fixture against the running API; the CSRF check needs a trusted Origin)
    {
      name: 'api',
      testDir: './api',
      use: { baseURL: 'http://localhost:3030', extraHTTPHeaders: { Origin: 'http://localhost:5173' } },
    },
    { name: 'chromium', testDir: './ui', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @api-selfservice/api dev',
      url: 'http://localhost:3030/health',
      // never reuse `pnpm dev`: it reads .env and may talk to a shared LiteLLM
      reuseExistingServer: false,
      cwd: '..',
      timeout: 90_000,
      env: { LITELLM_MODE: 'mock', DB_SCHEMA: 'api_selfservice_e2e' },
    },
    {
      command: 'pnpm --filter @api-selfservice/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      cwd: '..',
      timeout: 90_000,
    },
  ],
});
