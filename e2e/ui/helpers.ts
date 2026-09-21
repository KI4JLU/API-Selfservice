import { expect, type Page } from '@playwright/test';

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
