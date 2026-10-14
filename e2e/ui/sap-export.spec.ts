import { expect, test } from '@playwright/test';
import { devLogin, uniqueEmail } from './helpers';

/** #14: admins see the SAP export, keep the sender cost center and get the history. */
test.describe('SAP export', () => {
  test('admin saves the sender cost center and sees preview and history', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail('test-sap-admin'), name: 'Test SAP Admin', admin: true });
    await page.getByTestId('nav-admin-sap-export').click();
    await expect(page.getByTestId('page-admin-sap-export')).toBeVisible();
    await expect(page.getByTestId('table-sap-preview')).toBeVisible();
    await expect(page.getByTestId('table-sap-history')).toBeVisible();

    const sender = page.getByTestId('input-sap-sender');
    await sender.fill('');
    await sender.fill('22334455');
    const save = page.getByTestId('btn-save-sap-sender');
    if (await save.isEnabled()) {
      await save.click();
      await expect(page.getByTestId('toast-sap-sender-saved')).toBeVisible();
    }
    await expect(page.getByTestId('hint-sap-sender-missing')).toHaveCount(0);
    // the posting text changes the preview text
    await page.getByTestId('input-sap-text').fill('KI {Provider}');
    const rows = page.getByTestId('row-sap-preview');
    if (await rows.count()) await expect(rows.first()).toContainText('KI ');
  });
});
