import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { devLogin, uniqueEmail } from './helpers';

const API = 'http://localhost:3030';
const ORIGIN = { Origin: 'http://localhost:5173' };

type Provider = { id: string; modelName: string; tier: 'free' | 'paid'; available: boolean };

/**
 * Admin impersonation end to end (needs IMPERSONATION_ENABLED=true on the running API, otherwise skipped).
 * The key is created against whatever LiteLLM the API is configured with (LITELLM_MODE=http for the real proxy).
 * Everything that reaches LiteLLM (user e-mail, user alias, key alias) starts with "test".
 */
test.describe('admin impersonation', () => {
  test('admin acts as a user, creates a "Test key" in the UI, ends the impersonation', async ({ page }) => {
    const userEmail = uniqueEmail('test-impersonated');
    const adminEmail = uniqueEmail('test-impersonator');
    const userName = 'Test Impersonated User';
    const adminName = 'Test Impersonating Admin';

    // Separate cookie jars: the target user and an admin API session, independent of the admin's browser session.
    const userApi = await playwrightRequest.newContext({ baseURL: API, extraHTTPHeaders: ORIGIN });
    const adminApi = await playwrightRequest.newContext({ baseURL: API, extraHTTPHeaders: ORIGIN });
    const login = await userApi.post('/api/auth/dev-login', { data: { email: userEmail, name: userName } });
    expect(login.status(), await login.text()).toBe(200);
    expect((await adminApi.post('/api/auth/dev-login', { data: { email: adminEmail, name: adminName, admin: true } })).status()).toBe(200);
    const me = (await (await userApi.get('/api/v1/me')).json()) as { impersonationEnabled: boolean };
    test.skip(!me.impersonationEnabled, 'IMPERSONATION_ENABLED is not set on the running API');

    // Users on the default cost center only see free models. On a real proxy new models arrive as paid,
    // so mark one free for the duration of the test and restore it afterwards.
    const madeFree = await ensureFreeModel(adminApi);
    try {
      await devLogin(page, { email: adminEmail, name: adminName, admin: true });
      await expect(page.getByTestId('sidebar-user-name')).toHaveText(adminName);

      // Users / roles -> row menu -> Impersonate -> confirm
      await page.getByTestId('nav-admin-users').click();
      await expect(page.getByTestId('page-admin-users')).toBeVisible();
      await page.getByTestId('input-user-search').fill(userEmail);
      await page.getByTestId('btn-user-search').click();
      const row = page.getByTestId('table-users').locator('tr', { hasText: userEmail });
      await expect(row).toBeVisible();
      await row.getByTestId('btn-user-actions').click();
      await page.getByTestId('btn-impersonate-user').click();
      const confirm = page.getByTestId('dialog-impersonate-user');
      await expect(confirm).toBeVisible();
      await confirm.getByTestId('btn-confirm').click();

      // Now acting as the user: banner, sidebar name, no admin navigation.
      await expect(page.getByTestId('page-dashboard')).toBeVisible();
      const banner = page.getByTestId('impersonation-banner');
      await expect(banner).toBeVisible();
      await expect(banner.getByTestId('impersonation-user')).toHaveAttribute('data-user-email', userEmail);
      await expect(page.getByTestId('sidebar-user-name')).toHaveText(userName);
      await expect(page.getByTestId('nav-admin-users')).toHaveCount(0);

      // Create a key in the user's name (LiteLLM key alias: "<user e-mail>:Test key").
      await page.getByTestId('nav-keys').click();
      await expect(page.getByTestId('page-keys')).toBeVisible();
      await page.getByTestId('btn-create-key').click();
      const dialog = page.getByTestId('dialog-create-key');
      await expect(dialog).toBeVisible();
      await dialog.getByTestId('input-key-name').fill('Test key');
      const firstModel = dialog.getByTestId('list-models').locator('label').first();
      await expect(firstModel).toBeVisible();
      await firstModel.click();
      await expect(firstModel.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
      await dialog.getByTestId('btn-submit-create-key').click();
      const secret = page.getByTestId('dialog-key-secret');
      await expect(secret).toBeVisible();
      await secret.getByTestId('btn-close-secret').click();
      const keyRow = page.getByTestId('table-keys').locator('tr', { hasText: 'Test key' });
      await expect(keyRow).toBeVisible();
      await expect(keyRow.getByTestId('key-status')).toHaveAttribute('data-status', 'active');

      // The key belongs to the impersonated user, not to the admin.
      const userKeys = (await (await userApi.get('/api/v1/api-keys')).json()) as { items: { name: string; status: string }[] };
      expect(userKeys.items.map((k) => k.name)).toContain('Test key');

      // End the impersonation from the banner: back to the admin, on Users / roles.
      await banner.getByTestId('btn-stop-impersonation').click();
      await expect(page.getByTestId('page-admin-users')).toBeVisible();
      await expect(page.getByTestId('impersonation-banner')).toHaveCount(0);
      await expect(page.getByTestId('sidebar-user-name')).toHaveText(adminName);

      // The admin's own key list stays empty.
      await page.getByTestId('nav-keys').click();
      await expect(page.getByTestId('page-keys')).toBeVisible();
      await expect(page.getByTestId('table-keys').locator('tr', { hasText: 'Test key' })).toHaveCount(0);
    } finally {
      if (madeFree) await adminApi.patch(`/api/v1/admin/providers/${madeFree.id}`, { data: { tier: 'paid' } });
      await userApi.dispose();
      await adminApi.dispose();
    }
  });
});

/** Returns the provider that was switched to `free` for this test, or null when a free model already exists. */
async function ensureFreeModel(adminApi: APIRequestContext): Promise<Provider | null> {
  const res = await adminApi.get('/api/v1/admin/providers');
  expect(res.status(), await res.text()).toBe(200);
  const providers = (await res.json()) as Provider[];
  if (providers.some((p) => p.available && p.tier === 'free')) return null;
  const candidate = providers.find((p) => p.available);
  expect(candidate, 'no available model on the proxy').toBeTruthy();
  const patched = await adminApi.patch(`/api/v1/admin/providers/${candidate!.id}`, { data: { tier: 'free' } });
  expect(patched.status(), await patched.text()).toBe(200);
  return candidate!;
}
