import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for LiteLite (UI tests in e2e/ui, API tests in e2e/api).
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
      command: 'pnpm --filter @litelite/api dev',
      url: 'http://localhost:3030/health',
      reuseExistingServer: true,
      cwd: '..',
      timeout: 90_000,
    },
    {
      command: 'pnpm --filter @litelite/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      cwd: '..',
      timeout: 90_000,
    },
  ],
});
