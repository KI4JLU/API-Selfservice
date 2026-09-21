import { expect, test } from '@playwright/test';
import { devLogin, uniqueEmail } from './helpers';

test.describe('admin screens', () => {
  test('providers, reports, notifications, event log and my cost centers render', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail('admin'), name: 'Screen Admin', admin: true });

    await page.getByTestId('nav-admin-providers').click();
    await expect(page.getByTestId('page-admin-providers')).toBeVisible();
    await expect(page.getByTestId('table-providers').getByTestId('table-row').first()).toBeVisible();
    await page.getByTestId('btn-sync-providers').click();
    await expect(page.getByTestId('toast-providers-synced')).toBeVisible();
    await expect(page.getByTestId('btn-edit-provider').first()).toBeVisible();

    await page.getByTestId('nav-admin-reports').click();
    await expect(page.getByTestId('page-admin-reports')).toBeVisible();
    await expect(page.getByTestId('btn-export')).toBeDisabled();
    const firstRow = page.getByTestId('table-reports').getByTestId('table-row').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await expect(page.getByTestId('report-detail')).toBeVisible();

    await page.getByTestId('nav-admin-notifications').click();
    await expect(page.getByTestId('page-admin-notifications')).toBeVisible();
    await expect(page.getByTestId('table-notifications')).toBeVisible();

    // Event log: the admin's own first login is already recorded (user.create); a row opens its details.
    await page.getByTestId('nav-admin-events').click();
    await expect(page.getByTestId('page-admin-events')).toBeVisible();
    await page.getByTestId('input-event-action').fill('user.create');
    const eventRow = page.getByTestId('table-events').getByTestId('table-row').first();
    await expect(eventRow).toBeVisible();
    await expect(eventRow.getByTestId('event-action')).toHaveText('user.create');
    await eventRow.click();
    await expect(page.getByTestId('event-detail')).toBeVisible();

    await page.getByTestId('nav-cost-centers').click();
    await expect(page.getByTestId('page-cost-centers')).toBeVisible();
    await expect(page.getByTestId('card-cost-center').first()).toBeVisible();

    await page.getByTestId('nav-requests').click();
    await expect(page.getByTestId('page-requests')).toBeVisible();
    await expect(page.getByTestId('table-requests')).toBeVisible();
  });
});
