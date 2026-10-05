import { expect, test, type Page } from '@playwright/test';
import { devLogin, uniqueEmail } from './helpers';

async function expectKeysMenuItem(page: Page) {
  const item = page.getByTestId('nav-keys');
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(/\/keys$/);
  await expect(page.getByTestId('page-keys')).toBeVisible();
  await expect(page.getByTestId('btn-create-key')).toBeVisible();
}

test.describe('API keys menu item', () => {
  test('is shown to a plain user and opens the keys page', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail('nav-user'), name: 'Nav User' });
    await expect(page.getByTestId('nav-cost-centers')).toHaveCount(0);
    await expectKeysMenuItem(page);
  });

  test('is shown to a cost center admin and opens the keys page', async ({ browser }) => {
    const email = uniqueEmail('nav-ccadmin');
    const user = await browser.newContext({ locale: 'de-DE' });
    const userPage = await user.newPage();
    await devLogin(userPage, { email, name: 'Nav CC Admin' });

    // admin makes the user cost center admin of the default cost center
    const admin = await browser.newContext({ locale: 'de-DE' });
    const adminPage = await admin.newPage();
    await devLogin(adminPage, { email: uniqueEmail('nav-admin'), name: 'Nav Admin', admin: true });
    await adminPage.getByTestId('nav-admin-users').click();
    await adminPage.getByTestId('input-user-search').fill(email);
    await adminPage.getByTestId('btn-user-search').click();
    const row = adminPage.getByTestId('table-users').locator('tr', { hasText: email });
    await expect(row).toBeVisible();
    await row.getByTestId('btn-user-actions').click();
    await adminPage.getByTestId('btn-set-cost-center-admin').click();
    const dialog = adminPage.getByTestId('dialog-cost-center-admin');
    await dialog.getByTestId('cc-admin-11111111').click();
    await dialog.getByTestId('btn-save-cost-center-admin').click();
    await expect(dialog).toBeHidden();

    await userPage.reload();
    await expect(userPage.getByTestId('nav-cost-centers')).toBeVisible();
    await expectKeysMenuItem(userPage);

    await user.close();
    await admin.close();
  });

  test('is shown to an admin and opens the keys page', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail('nav-admin'), name: 'Nav Admin', admin: true });
    await expect(page.getByTestId('nav-admin-users')).toBeVisible();
    await expectKeysMenuItem(page);
  });
});

test.describe('API keys', () => {
  test('create key shows the secret once, then extend and delete', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail('keys'), name: 'Key User' });
    await page.getByTestId('nav-keys').click();
    await expect(page.getByTestId('page-keys')).toBeVisible();

    await page.getByTestId('btn-create-key').click();
    const dialog = page.getByTestId('dialog-create-key');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('input-key-name').fill('Playwright key');
    // default cost center -> only free models are offered; paid-model hint is shown
    await expect(dialog.getByTestId('hint-paid-models')).toBeVisible();
    const firstModel = dialog.getByTestId('list-models').locator('label').first();
    await expect(firstModel).toBeVisible();
    // Radix renders a hidden <input> next to the checkbox button; click the label and assert via the role instead.
    await firstModel.click();
    await expect(firstModel.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    // F-KEY-11: with an amount the budget resets monthly by default
    await expect(dialog.getByTestId('input-key-budget-period')).toBeDisabled();
    await dialog.getByTestId('input-key-budget').fill('5');
    await expect(dialog.getByTestId('input-key-budget-period')).toBeEnabled();
    await dialog.getByTestId('btn-submit-create-key').click();

    const secret = page.getByTestId('dialog-key-secret');
    await expect(secret).toBeVisible();
    const secretText = (await secret.getByTestId('key-secret').textContent())?.trim() ?? '';
    expect(secretText.length).toBeGreaterThan(10);
    await secret.getByTestId('btn-copy-secret').click();
    await secret.getByTestId('btn-close-secret').click();
    await expect(secret).toBeHidden();

    const row = page.getByTestId('table-keys').locator('tr', { hasText: 'Playwright key' });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('key-status')).toHaveAttribute('data-status', 'active');
    // masked key is shown, never the secret
    await expect(page.getByTestId('table-keys')).not.toContainText(secretText);
    // the cost center shows by name, without its internal number; the budget per month
    await expect(row.getByTestId('key-cost-center')).not.toContainText('1111');
    await expect(row).toContainText(/\/ (Monat|month)/);

    await row.getByTestId('btn-extend-key').click();
    await expect(page.getByTestId('toast-key-extended')).toBeVisible();

    await row.getByTestId('btn-delete-key').click();
    await expect(page.getByTestId('dialog-delete-key')).toBeVisible();
    await page.getByTestId('dialog-delete-key').getByTestId('btn-confirm').click();
    await expect(page.getByTestId('dialog-delete-key')).toBeHidden();
    await expect(page.getByTestId('table-keys').locator('tr', { hasText: 'Playwright key' })).toHaveCount(0);
  });

  test('create key for a whole provider via the provider tab (F-KEY-10)', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail('keys-provider'), name: 'Provider Key User' });
    await page.getByTestId('nav-keys').click();
    await page.getByTestId('btn-create-key').click();
    const dialog = page.getByTestId('dialog-create-key');
    await dialog.getByTestId('input-key-name').fill('Provider key');
    await dialog.getByTestId('tab-providers').click();
    // default cost center -> only providers with free models are offered
    const firstProvider = dialog.getByTestId('list-providers').locator('label').first();
    await expect(firstProvider).toBeVisible();
    const providerName = ((await firstProvider.getAttribute('data-testid')) ?? '').replace(/^provider-/, '');
    await firstProvider.click();
    await expect(firstProvider.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    // the provider's models show as included in the models tab
    await dialog.getByTestId('tab-models').click();
    await expect(dialog.getByTestId('list-models').getByRole('checkbox', { checked: true }).first()).toBeDisabled();
    // the models tab is grouped by provider; the chosen provider's models sit in its group
    const group = dialog.getByTestId(`model-group-${providerName}`);
    await expect(group).toContainText(providerName);
    await expect(group.getByRole('checkbox', { checked: true }).first()).toBeDisabled();
    await dialog.getByTestId('btn-submit-create-key').click();

    const secret = page.getByTestId('dialog-key-secret');
    await expect(secret).toBeVisible();
    await secret.getByTestId('btn-close-secret').click();
    const row = page.getByTestId('table-keys').locator('tr', { hasText: 'Provider key' });
    await expect(row.getByTestId('key-provider')).toContainText(providerName);
  });
});
