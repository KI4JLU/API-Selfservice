import { expect, test } from '@playwright/test';
import { apiLogin, devLogin, formatCc, uniqueCostCenter, uniqueEmail } from './helpers';

test.describe('admin screens', () => {
  test('providers, reports, notifications and event log render; my cost centers stay hidden', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail('admin'), name: 'Screen Admin', admin: true });

    await page.getByTestId('nav-admin-providers').click();
    await expect(page.getByTestId('page-admin-providers')).toBeVisible();
    await expect(page.getByTestId('table-providers').getByTestId('table-row').first()).toBeVisible();
    await page.getByTestId('btn-sync-providers').click();
    await expect(page.getByTestId('toast-providers-synced')).toBeVisible();
    await expect(page.getByTestId('btn-edit-provider').first()).toBeVisible();
    // the model name opens the edit dialog
    await page.getByTestId('provider-model').first().click();
    await expect(page.getByTestId('dialog-edit-provider')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dialog-edit-provider')).toBeHidden();

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

    // An admin who is not cost center admin of any cost center has no "My cost centers".
    await expect(page.getByTestId('nav-cost-centers')).toHaveCount(0);

    await page.getByTestId('nav-requests').click();
    await expect(page.getByTestId('page-requests')).toBeVisible();
    await expect(page.getByTestId('table-requests')).toBeVisible();
  });

  /** F-KST-15: the model release is grouped by provider; the provider checkbox selects all of its models. */
  test('cost center model release is grouped by provider', async ({ page }) => {
    const email = uniqueEmail('test-cc-models-admin');
    const cc = uniqueCostCenter();
    const root = await apiLogin({ email, name: 'Test Models Admin', admin: true });
    expect((await root.api.post('/api/v1/admin/providers/sync')).status()).toBe(200);
    const created = await root.api.post('/api/v1/admin/cost-centers', { data: { number: cc, name: 'Test Models', ownerUserId: root.id } });
    expect(created.status(), await created.text()).toBe(201);
    const ccId = ((await created.json()) as { id: string }).id;

    await devLogin(page, { email, name: 'Test Models Admin', admin: true });
    await page.getByTestId('nav-admin-cost-centers').click();
    await page.getByTestId('input-cc-search').fill(cc);
    await page.getByTestId('input-cc-search').press('Enter');
    await page
      .getByTestId('table-cost-centers')
      .locator('tr', { hasText: formatCc(cc) })
      .getByTestId('btn-edit-cost-center')
      .click();
    const dialog = page.getByTestId('dialog-edit-cost-center');
    await expect(dialog).toBeVisible();

    // groups start collapsed; the provider checkbox selects all of its models
    const group = dialog.locator('[data-testid^="cc-provider-"]').first();
    await expect(group).toBeVisible();
    await expect(group.locator('[data-testid^="cc-model-"]')).toHaveCount(0);
    await group.getByRole('checkbox').first().click();
    await group.getByTestId('btn-cc-provider-toggle').click();
    const models = group.locator('[data-testid^="cc-model-"]');
    const names = (await models.evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace(/^cc-model-/, '')))).sort();
    expect(names.length).toBeGreaterThan(0);
    for (const m of await models.all()) await expect(m.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');

    // the filter narrows the list and expands matching groups
    await dialog.getByTestId('input-cc-models-filter').fill(names[0]);
    await expect(dialog.getByTestId(`cc-model-${names[0]}`)).toBeVisible();
    await dialog.getByTestId('input-cc-models-filter').fill('');

    await dialog.getByTestId('btn-save-cost-center').click();
    await expect(dialog).toBeHidden();
    const saved = (await (await root.api.get(`/api/v1/cost-centers/${ccId}`)).json()) as { models: string[] };
    expect([...saved.models].sort()).toEqual(names);

    // "none" clears the release again (= all models)
    await page
      .getByTestId('table-cost-centers')
      .locator('tr', { hasText: formatCc(cc) })
      .getByTestId('btn-edit-cost-center')
      .click();
    await dialog.getByTestId('btn-cc-models-none').click();
    await dialog.getByTestId('btn-save-cost-center').click();
    await expect(dialog).toBeHidden();
    expect(((await (await root.api.get(`/api/v1/cost-centers/${ccId}`)).json()) as { models: string[] }).models).toEqual([]);
    await root.api.dispose();
  });
});
