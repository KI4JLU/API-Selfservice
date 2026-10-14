import { expect, test } from '@playwright/test';
import { apiLogin, devLogin, formatCc, uniqueCostCenter, uniqueEmail } from './helpers';

/** #13: one page per cost center with key figures, members, budget usage and events. */
test.describe('cost center detail page', () => {
  test('cost center admin opens the page, approves a join request and sees usage and events', async ({ page }) => {
    const ccAdminEmail = uniqueEmail('test-detail-admin');
    const cc = uniqueCostCenter();
    const root = await apiLogin({ email: uniqueEmail('test-detail-root'), name: 'Test Root Admin', admin: true });
    const ccAdmin = await apiLogin({ email: ccAdminEmail, name: 'Test Detail Admin' });
    const joiner = await apiLogin({ email: uniqueEmail('test-detail-joiner'), name: 'Test Detail Joiner' });
    const created = await root.api.post('/api/v1/admin/cost-centers', {
      data: { sapRecipient: { type: 'cost_center', number: '12345678' }, number: cc, name: 'Test Detail', ownerUserId: ccAdmin.id },
    });
    expect(created.status(), await created.text()).toBe(201);
    const ccId = ((await created.json()) as { id: string }).id;
    const req = await joiner.api.post('/api/v1/me/join-requests', { data: { costCenterId: ccId, message: 'x'.repeat(300) } });
    expect(req.status(), await req.text()).toBe(201);

    await devLogin(page, { email: ccAdminEmail, name: 'Test Detail Admin' });
    await page.getByTestId('nav-cost-centers').click();
    await page
      .getByTestId('card-cost-center')
      .filter({ hasText: formatCc(cc) })
      .getByTestId('btn-open-cost-center')
      .click();
    await expect(page.getByTestId('page-cost-center-detail')).toBeVisible();
    await expect(page.getByTestId('cost-center-title')).toHaveText('Test Detail');
    await expect(page.getByTestId('kpi-members')).toContainText('1');

    // members tab: the long reason is cut and can be expanded; approving adds the member
    const request = page.getByTestId('item-join-request');
    await expect(request).toHaveCount(1);
    await request.getByTestId('btn-join-request-reason-toggle').click();
    await request.getByTestId('btn-approve-join-request').click();
    await expect(page.getByTestId('row-member')).toHaveCount(2);
    await expect(page.getByTestId('row-member').filter({ hasText: 'Test Detail Joiner' }).getByTestId('member-key-count')).toHaveText('0');

    // usage tab: no requests yet
    await page.getByTestId('tab-trigger-usage').click();
    await expect(page.getByTestId('table-usage')).toBeVisible();
    await page.getByTestId('input-usage-group').click();
    await page.getByRole('option').nth(2).click();
    await expect(page.getByTestId('table-usage')).toBeVisible();

    // events tab: the approval is listed under requests
    await page.getByTestId('tab-trigger-events').click();
    await page.getByTestId('chip-event-requests').click();
    await expect(page.getByTestId('row-event').filter({ hasText: 'Test Detail Joiner' }).first()).toBeVisible();
    await expect(page.locator('[data-testid="row-event"][data-action="cost_center.join_approve"]')).toHaveCount(1);
  });
});
