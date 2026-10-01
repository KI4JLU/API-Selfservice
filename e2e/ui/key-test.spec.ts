import { expect, test } from '@playwright/test';
import { devLogin, uniqueEmail } from './helpers';

test.describe('key test', () => {
  test('a freshly created key answers a test prompt', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail('keytest'), name: 'Key Test User' });

    // create a key and keep the secret
    await page.getByTestId('nav-keys').click();
    await page.getByTestId('btn-create-key').click();
    const dialog = page.getByTestId('dialog-create-key');
    await dialog.getByTestId('input-key-name').fill('Key test');
    await dialog.getByTestId('list-models').locator('label').first().click();
    await dialog.getByTestId('btn-submit-create-key').click();
    const secretDialog = page.getByTestId('dialog-key-secret');
    const secret = ((await secretDialog.getByTestId('key-secret').textContent()) ?? '').trim();
    expect(secret.length).toBeGreaterThan(10);
    await secretDialog.getByTestId('btn-close-secret').click();

    await page.getByTestId('nav-key-test').click();
    await expect(page.getByTestId('page-key-test')).toBeVisible();
    await page.getByTestId('input-key-test-key').fill(secret);
    await page.getByTestId('btn-load-models').click();
    await expect(page.getByTestId('input-key-test-model')).toBeVisible();
    await page.getByTestId('btn-send-key-test').click();
    await expect(page.getByTestId('key-test-success')).toBeVisible();
    await expect(page.getByTestId('key-test-answer')).not.toBeEmpty();
    await expect(page.getByTestId('key-test-error')).toHaveCount(0);
  });

  test('an unknown key is rejected before a model can be chosen', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail('keytest'), name: 'Key Test User' });
    await page.getByTestId('nav-key-test').click();
    await page.getByTestId('input-key-test-key').fill('sk-does-not-exist');
    await page.getByTestId('btn-load-models').click();
    await expect(page.getByTestId('key-test-error')).toBeVisible();
    await expect(page.getByTestId('input-key-test-model')).toHaveCount(0);
  });
});
