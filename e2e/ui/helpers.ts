import fs from 'node:fs';
import path from 'node:path';
import { expect, request as playwrightRequest, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const API = 'http://localhost:3030';
const ORIGIN = { Origin: 'http://localhost:5173' };

export function uniqueEmail(prefix = 'user') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;
}

export function uniqueCostCenter() {
  // 8 digits, never the default 11111111
  return String(20000000 + (Date.now() % 79999999)).padStart(8, '0');
}

export function formatCc(n: string) {
  return `${n.slice(0, 4)} ${n.slice(4)}`;
}

/** Signs in through the dev login form (DEV only) and waits for the dashboard. */
export async function devLogin(page: Page, opts: { email: string; name?: string; admin?: boolean }) {
  await page.goto('/login');
  await expect(page.getByTestId('form-dev-login')).toBeVisible();
  await page.getByTestId('input-dev-email').fill(opts.email);
  if (opts.name) await page.getByTestId('input-dev-name').fill(opts.name);
  if (opts.admin) await page.getByTestId('checkbox-dev-admin').check();
  await page.getByTestId('btn-dev-login').click();
  await expect(page.getByTestId('page-dashboard')).toBeVisible({ timeout: 15_000 });
}

/** Separate API session (own cookie jar) via dev login; returns the context and the user id. */
export async function apiLogin(data: { email: string; name: string; admin?: boolean }): Promise<{ api: APIRequestContext; id: string }> {
  const api = await playwrightRequest.newContext({ baseURL: API, extraHTTPHeaders: ORIGIN });
  const login = await api.post('/api/auth/dev-login', { data });
  expect(login.status(), await login.text()).toBe(200);
  return { api, id: ((await (await api.get('/api/v1/me')).json()) as { id: string }).id };
}

/** Waits until a DataTable has loaded (no skeleton rows left). */
export async function tableLoaded(table: Locator) {
  await expect(table).toBeVisible();
  await expect(table.locator('[data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Numbered full-page screenshots for the walkthrough specs, saved to e2e/screenshots/<flow>/
 * (kept after the run, unlike test-results/). The folder is emptied when the walkthrough starts.
 */
export function walkthroughShots(page: Page, flow: string) {
  const dir = path.join(__dirname, '..', 'screenshots', flow);
  fs.rmSync(dir, { recursive: true, force: true });
  let n = 0;
  return async (name: string, opts: { mask?: Locator[] } = {}) => {
    await page.waitForTimeout(400); // dialogs, sheets and toasts animate in
    n += 1;
    await page.screenshot({ path: path.join(dir, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: true, mask: opts.mask });
  };
}
