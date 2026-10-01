import { expect, test } from '@playwright/test';
import { apiLogin, devLogin, formatCc, tableLoaded, uniqueCostCenter, uniqueEmail, walkthroughShots } from './helpers';

/**
 * Walkthrough from the user's point of view: every screen and step, one numbered screenshot per step
 * in e2e/screenshots/user/ and e2e/screenshots/cost-center-admin/.
 * Names and e-mails start with "test" because the API may run against a real LiteLLM proxy (LITELLM_MODE=http).
 */
test.describe('walkthrough: user', () => {
  test('user signs in, creates, tests, extends and deletes an API key', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const shot = walkthroughShots(page, 'user');
    const keyName = 'Test walkthrough key';

    // --- login and dashboard
    await page.goto('/login');
    await expect(page.getByTestId('form-dev-login')).toBeVisible();
    await shot('login');
    await devLogin(page, { email: uniqueEmail('test-walk-user'), name: 'Test Walkthrough User' });
    await expect(page.getByTestId('budget-cards')).toBeVisible();
    await expect(page.getByTestId('nav-admin-users')).toHaveCount(0);
    await shot('dashboard');

    await page.getByTestId('btn-help').click();
    await expect(page.getByTestId('sheet-help')).toBeVisible();
    await shot('help');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sheet-help')).toBeHidden();

    // --- create a key
    await page.getByTestId('nav-keys').click();
    await expect(page.getByTestId('page-keys')).toBeVisible();
    await tableLoaded(page.getByTestId('table-keys'));
    await shot('keys-empty');
    await page.getByTestId('btn-create-key').click();
    const dialog = page.getByTestId('dialog-create-key');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('input-key-name').fill(keyName);
    const firstModel = dialog.getByTestId('list-models').locator('label').first();
    await expect(firstModel).toBeVisible();
    await firstModel.click();
    await expect(firstModel.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    await dialog.getByTestId('input-key-budget').fill('5');
    await shot('key-create');
    await dialog.getByTestId('btn-submit-create-key').click();

    // the secret is shown once; it is masked in every screenshot
    const secretDialog = page.getByTestId('dialog-key-secret');
    await expect(secretDialog).toBeVisible();
    const secret = ((await secretDialog.getByTestId('key-secret').textContent()) ?? '').trim();
    expect(secret.length).toBeGreaterThan(10);
    await shot('key-secret', { mask: [secretDialog.getByTestId('key-secret')] });
    await secretDialog.getByTestId('btn-close-secret').click();
    await expect(secretDialog).toBeHidden();

    const row = page.getByTestId('table-keys').locator('tr', { hasText: keyName });
    await expect(row.getByTestId('key-status')).toHaveAttribute('data-status', 'active');
    await shot('keys-list');

    await row.getByTestId('btn-extend-key').click();
    await expect(page.getByTestId('toast-key-extended')).toBeVisible();
    await shot('key-extended');

    // --- test the key
    await page.getByTestId('nav-key-test').click();
    await expect(page.getByTestId('page-key-test')).toBeVisible();
    const keyInput = page.getByTestId('input-key-test-key');
    await keyInput.fill(secret);
    await page.getByTestId('btn-load-models').click();
    await expect(page.getByTestId('input-key-test-model')).toBeVisible();
    await shot('key-test-models', { mask: [keyInput] });
    await page.getByTestId('btn-send-key-test').click();
    await expect(page.getByTestId('key-test-success')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('key-test-answer')).not.toBeEmpty();
    await shot('key-test-answer', { mask: [keyInput] });

    // --- request log (a real proxy may not have logged the test request yet)
    await page.getByTestId('nav-requests').click();
    await expect(page.getByTestId('page-requests')).toBeVisible();
    await tableLoaded(page.getByTestId('table-requests'));
    await shot('requests');
    const logRow = page.getByTestId('table-requests').getByTestId('table-row').first();
    if ((await logRow.count()) > 0) {
      await logRow.click();
      await expect(page.getByTestId('sheet-request-detail')).toBeVisible();
      await shot('request-detail');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('sheet-request-detail')).toBeHidden();
    }

    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('budget-cards')).toBeVisible();
    await shot('dashboard-after-usage');

    // --- profile, dark mode, mobile
    await page.getByTestId('btn-user-menu').click();
    await shot('user-menu');
    await page.getByTestId('nav-profile').click();
    await expect(page.getByTestId('page-profile')).toBeVisible();
    await shot('profile');
    await page.getByTestId('btn-save-profile').click();

    const html = page.locator('html');
    const wasDark = await html.evaluate((el) => el.dataset.theme === 'dark');
    await page.getByTestId('btn-user-menu').click();
    await page.getByTestId('btn-theme').click();
    await expect(html).toHaveAttribute('data-theme', wasDark ? 'light' : 'dark');
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-keys').click();
    await expect(row).toBeVisible();
    await shot(wasDark ? 'keys-light' : 'keys-dark');
    await page.getByTestId('btn-user-menu').click();
    await page.getByTestId('btn-theme').click();
    await expect(html).toHaveAttribute('data-theme', wasDark ? 'dark' : 'light');
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 375, height: 800 });
    await shot('keys-mobile');
    await page.getByTestId('btn-sidebar-toggle').click();
    await expect(page.locator('[data-sidebar="sidebar"][data-mobile="true"]')).toBeVisible();
    await shot('mobile-nav');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 900 });

    // --- delete the key and sign out
    await row.getByTestId('btn-delete-key').click();
    const deleteDialog = page.getByTestId('dialog-delete-key');
    await expect(deleteDialog).toBeVisible();
    await shot('key-delete');
    await deleteDialog.getByTestId('btn-confirm').click();
    await expect(deleteDialog).toBeHidden();
    await expect(row).toHaveCount(0);
    await shot('key-deleted');

    await page.getByTestId('btn-user-menu').click();
    await page.getByTestId('btn-logout').click();
    await expect(page).toHaveURL(/\/login/);
    await shot('logged-out');
  });

  test('cost center admin reviews the report, sets the budget and manages members', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const shot = walkthroughShots(page, 'cost-center-admin');
    const email = uniqueEmail('test-walk-ccadmin');
    const memberEmail = uniqueEmail('test-walk-ccmember');
    const cc = uniqueCostCenter();

    // Setup: an admin creates a cost center owned by the user; the owner is its cost center admin (F-KST-14).
    const root = await apiLogin({ email: uniqueEmail('test-walk-root'), name: 'Test Walkthrough Root', admin: true });
    const ccAdmin = await apiLogin({ email, name: 'Test Walkthrough CC Admin' });
    const member = await apiLogin({ email: memberEmail, name: 'Test Walkthrough CC Member' });
    const created = await root.api.post('/api/v1/admin/cost-centers', { data: { number: cc, name: 'Test Walkthrough CC', ownerUserId: ccAdmin.id } });
    expect(created.status(), await created.text()).toBe(201);
    const ccId = ((await created.json()) as { id: string }).id;

    try {
      await devLogin(page, { email, name: 'Test Walkthrough CC Admin' });
      await expect(page.getByTestId('nav-cost-centers')).toBeVisible();
      await shot('dashboard');

      await page.getByTestId('nav-cost-centers').click();
      await expect(page.getByTestId('page-cost-centers')).toBeVisible();
      const card = page.getByTestId('card-cost-center').filter({ hasText: formatCc(cc) });
      await expect(card).toBeVisible();
      await shot('cost-centers');

      // --- report
      await card.getByTestId('btn-cost-center-report').click();
      await expect(page.getByTestId('sheet-report-detail')).toBeVisible();
      await expect(page.getByTestId('report-detail')).toBeVisible();
      await shot('report');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('sheet-report-detail')).toBeHidden();

      // --- budget
      await card.getByTestId('btn-edit-cost-center').click();
      const edit = page.getByTestId('dialog-edit-cost-center');
      await expect(edit).toBeVisible();
      await edit.getByTestId('input-budget-amount').fill('80');
      await shot('budget-edit');
      await edit.getByTestId('btn-save-cost-center').click();
      await expect(edit).toBeHidden();
      await expect(card).toContainText('80,00');
      await shot('budget-saved');

      // --- members: add, then remove
      await card.getByTestId('btn-cost-center-members').click();
      const sheet = page.getByTestId('sheet-cost-center-members');
      await expect(sheet.getByTestId('badge-member-owner')).toBeVisible();
      await shot('members');
      await sheet.getByTestId('input-member-search').fill(memberEmail);
      await sheet.getByTestId('btn-member-search').click();
      const candidate = sheet.getByTestId('item-member-candidate').filter({ hasText: memberEmail });
      await expect(candidate).toBeVisible();
      await shot('member-search');
      await candidate.getByTestId('btn-add-member').click();
      const memberRow = sheet.locator(`[data-testid="row-member"][data-user-id="${member.id}"]`);
      await expect(memberRow.getByTestId('member-status')).toHaveAttribute('data-status', 'active');
      await shot('member-added');

      await memberRow.getByTestId('btn-remove-member').click();
      const remove = page.getByTestId('dialog-remove-member');
      await expect(remove).toBeVisible();
      await shot('member-remove');
      await remove.getByTestId('btn-confirm').click();
      await expect(memberRow).toHaveCount(0);
      await shot('member-removed');
    } finally {
      await root.api.post(`/api/v1/admin/cost-centers/${ccId}/archive`);
      for (const c of [root, ccAdmin, member]) await c.api.dispose();
    }
  });
});
