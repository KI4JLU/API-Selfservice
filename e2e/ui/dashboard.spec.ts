import { expect, test } from '@playwright/test';
import { apiLogin, devLogin, uniqueCostCenter, uniqueEmail } from './helpers';

test.describe('login and dashboard', () => {
  test('user logs in via dev login and sees the budget dashboard', async ({ page }) => {
    const email = uniqueEmail();
    await devLogin(page, { email, name: 'Test User' });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('budget-cards')).toBeVisible();
    await expect(page.getByTestId('metrics-cards')).toBeVisible();
    await expect(page.getByTestId('table-top-keys')).toBeVisible();
    await expect(page.getByTestId('input-month')).toHaveValue(/^\d{4}-\d{2}$/);
    // user nav is visible, admin nav is not
    await expect(page.getByTestId('nav-keys')).toBeVisible();
    await expect(page.getByTestId('nav-admin-users')).toHaveCount(0);
  });

  test('dashboard shows key hints and cost centers; the directory lists the default as member', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail(), name: 'Overview User' });
    await expect(page.getByTestId('hint-no-key')).toBeVisible();
    await expect(page.getByTestId('btn-dashboard-create-key')).toBeVisible();
    await expect(page.getByTestId('my-cost-center')).toHaveCount(1);
    await page.getByTestId('link-join-cost-center').click();
    await expect(page.getByTestId('page-cost-center-directory')).toBeVisible();
    await expect(page.getByTestId('cc-membership').first()).toHaveAttribute('data-status', 'member');
  });

  /** F-KST-16: a user asks to join from the directory; the request shows as pending there and on the dashboard. */
  test('user asks to join a cost center from the directory', async ({ page }) => {
    const root = await apiLogin({ email: uniqueEmail('test-join-root'), name: 'Test Root Admin', admin: true });
    const name = `Test Join ${Date.now()}`;
    const created = await root.api.post('/api/v1/admin/cost-centers', { data: { number: uniqueCostCenter(), name, ownerUserId: root.id } });
    expect(created.status(), await created.text()).toBe(201);

    await devLogin(page, { email: uniqueEmail('test-joiner'), name: 'Test Joiner' });
    await page.getByTestId('nav-cost-center-directory').click();
    await page.getByTestId('input-cost-center-search').fill(name);
    const row = page.getByTestId('table-cost-center-directory').locator('tr', { hasText: name });
    await row.getByTestId('btn-join-cost-center').click();
    const dialog = page.getByTestId('dialog-join-cost-center');
    await dialog.getByTestId('input-join-message').fill('Projekt KI');
    await dialog.getByTestId('btn-send-join-request').click();
    await expect(page.getByTestId('toast-join-requested')).toBeVisible();
    await expect(row.getByTestId('cc-membership')).toHaveAttribute('data-status', 'pending');
    await expect(row.getByTestId('btn-join-cost-center')).toHaveCount(0);

    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('my-join-request').filter({ hasText: name })).toBeVisible();
    await root.api.dispose();
  });

  test('unauthenticated visit redirects to login', async ({ page }) => {
    await page.goto('/keys');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('btn-login-keycloak')).toBeVisible();
  });

  test('language switch changes the UI and persists', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail(), name: 'Lang User' });
    await expect(page.getByTestId('nav-keys')).toHaveText('API-Keys');
    await page.getByTestId('btn-user-menu').click();
    await page.getByTestId('btn-lang-en').click();
    await expect(page.getByTestId('nav-keys')).toHaveText('API keys');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();
    await expect(page.getByTestId('nav-keys')).toHaveText('API keys');
    await page.getByTestId('btn-user-menu').click();
    await page.getByTestId('btn-lang-de').click();
    await expect(page.getByTestId('nav-keys')).toHaveText('API-Keys');
  });

  test('dark mode toggle sets data-theme and persists', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail(), name: 'Dark User' });
    const html = page.locator('html');
    const wasDark = await html.evaluate((el) => el.dataset.theme === 'dark');
    await page.getByTestId('btn-user-menu').click();
    await page.getByTestId('btn-theme').click();
    await expect(html).toHaveAttribute('data-theme', wasDark ? 'light' : 'dark');
    await page.reload();
    await expect(page.getByTestId('page-dashboard')).toBeVisible();
    expect(await html.evaluate((el) => el.dataset.theme === 'dark')).toBe(!wasDark);
    // toggle back
    await page.getByTestId('btn-user-menu').click();
    await page.getByTestId('btn-theme').click();
    expect(await html.evaluate((el) => el.dataset.theme === 'dark')).toBe(wasDark);
  });

  test('help sheet opens with the section of the current screen', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail(), name: 'Help User' });
    await page.getByTestId('nav-keys').click();
    await expect(page.getByTestId('page-keys')).toBeVisible();
    await page.getByTestId('btn-help').click();
    await expect(page.getByTestId('sheet-help')).toBeVisible();
    await expect(page.getByTestId('help-content')).toHaveAttribute('data-section', 'keys');
    await page.getByTestId('help-section-profile').click();
    await expect(page.getByTestId('help-content')).toHaveAttribute('data-section', 'profile');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sheet-help')).toBeHidden();
  });

  test('sign out returns to the login page', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail(), name: 'Logout User' });
    await page.getByTestId('btn-user-menu').click();
    await expect(page.getByTestId('user-role')).toHaveAttribute('data-role', 'user');
    await page.getByTestId('btn-logout').click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
