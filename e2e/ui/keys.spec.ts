import { expect, test } from '@playwright/test';
import { devLogin, uniqueEmail } from './helpers';

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

    await row.getByTestId('btn-extend-key').click();
    await expect(page.getByTestId('toast-key-extended')).toBeVisible();

    await row.getByTestId('btn-delete-key').click();
    await expect(page.getByTestId('dialog-delete-key')).toBeVisible();
    await page.getByTestId('dialog-delete-key').getByTestId('btn-confirm').click();
    await expect(page.getByTestId('dialog-delete-key')).toBeHidden();
    await expect(page.getByTestId('table-keys').locator('tr', { hasText: 'Playwright key' })).toHaveCount(0);
  });
});
