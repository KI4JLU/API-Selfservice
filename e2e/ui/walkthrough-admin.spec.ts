import { expect, test } from '@playwright/test';
import { apiLogin, devLogin, formatCc, tableLoaded, uniqueCostCenter, uniqueEmail, walkthroughShots } from './helpers';

/** Distinct 8-digit numbers for the cost centers of one run. */
function costCenterNumbers(count: number) {
  const base = Number(uniqueCostCenter());
  return Array.from({ length: count }, (_, i) => String(base - i));
}

/**
 * Walkthrough from the admin's point of view: every admin screen and step, one numbered screenshot per step
 * in e2e/screenshots/admin/.
 * Names and e-mails start with "test" because the API may run against a real LiteLLM proxy (LITELLM_MODE=http).
 */
test.describe('walkthrough: admin', () => {
  test('admin manages cost centers, requests, users and providers and reviews reports and events', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const shot = walkthroughShots(page, 'admin');
    const [newCc, approveCc, rejectCc] = costCenterNumbers(3);
    const ownerEmail = uniqueEmail('test-walk-owner');
    const memberEmail = uniqueEmail('test-walk-member');
    const requesterEmail = uniqueEmail('test-walk-requester');
    const rejectedEmail = uniqueEmail('test-walk-rejected');

    // Setup: signing in makes the users known to LiteLLM; two of them request a new cost center.
    const owner = await apiLogin({ email: ownerEmail, name: 'Test Walkthrough Owner' });
    const member = await apiLogin({ email: memberEmail, name: 'Test Walkthrough Member' });
    const requester = await apiLogin({ email: requesterEmail, name: 'Test Walkthrough Requester' });
    const rejected = await apiLogin({ email: rejectedEmail, name: 'Test Walkthrough Rejected' });
    for (const [u, number, name, email] of [
      [requester, approveCc, 'Test Walkthrough Requester', requesterEmail],
      [rejected, rejectCc, 'Test Walkthrough Rejected', rejectedEmail],
    ] as const) {
      const res = await u.api.patch('/api/v1/me', { data: { costCenterNumber: number, costCenterOwnerName: name, costCenterOwnerEmail: email } });
      expect(res.status(), await res.text()).toBe(200);
    }

    try {
      await devLogin(page, { email: uniqueEmail('test-walk-admin'), name: 'Test Walkthrough Admin', admin: true });
      await expect(page.getByTestId('nav-admin-users')).toBeVisible();
      await shot('dashboard');

      // --- cost centers: create with owner and budget
      await page.getByTestId('nav-admin-cost-centers').click();
      await expect(page.getByTestId('page-admin-cost-centers')).toBeVisible();
      await tableLoaded(page.getByTestId('table-cost-centers'));
      await shot('cost-centers');
      await page.getByTestId('btn-create-cost-center').click();
      const create = page.getByTestId('dialog-create-cost-center');
      await expect(create).toBeVisible();
      await create.getByTestId('input-cc-number').fill(newCc);
      await create.getByTestId('input-cc-name').fill('Test Walkthrough');
      await create.getByTestId('input-owner-search').fill(ownerEmail);
      await create.getByTestId('btn-owner-search').click();
      await create.getByTestId('list-owner-candidates').locator('li', { hasText: ownerEmail }).getByTestId('btn-pick-owner').click();
      await expect(create.getByTestId('owner-selected')).toContainText('Test Walkthrough Owner');
      await create.getByTestId('input-budget-amount').fill('100');
      await shot('cost-center-create');
      await create.getByTestId('btn-submit-create-cost-center').click();
      await expect(create).toBeHidden();

      await page.getByTestId('input-cc-search').fill(newCc);
      await page.getByTestId('input-cc-search').press('Enter');
      const ccRow = page.getByTestId('table-cost-centers').locator('tr', { hasText: formatCc(newCc) });
      await expect(ccRow.getByTestId('cc-status')).toHaveAttribute('data-status', 'approved');
      await shot('cost-center-created');

      // --- edit name and budget
      await ccRow.getByTestId('btn-edit-cost-center').click();
      const edit = page.getByTestId('dialog-edit-cost-center');
      await expect(edit).toBeVisible();
      await edit.getByTestId('input-cc-name').fill('Test Walkthrough edited');
      await edit.getByTestId('input-budget-amount').fill('150');
      await shot('cost-center-edit');
      await edit.getByTestId('btn-save-cost-center').click();
      await expect(edit).toBeHidden();
      await expect(ccRow.getByTestId('cc-row-name')).toHaveText('Test Walkthrough edited');
      await expect(ccRow).toContainText('150,00');
      await shot('cost-center-edited');

      // --- members
      await ccRow.getByTestId('btn-cost-center-members').click();
      const sheet = page.getByTestId('sheet-cost-center-members');
      await expect(sheet.getByTestId('badge-member-owner')).toBeVisible();
      await sheet.getByTestId('input-member-search').fill(memberEmail);
      await sheet.getByTestId('btn-member-search').click();
      await sheet.getByTestId('item-member-candidate').filter({ hasText: memberEmail }).getByTestId('btn-add-member').click();
      await expect(sheet.locator(`[data-testid="row-member"][data-user-id="${member.id}"]`)).toBeVisible();
      await shot('cost-center-members');
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();

      // --- requests: approve one, reject one
      await page.getByTestId('tab-requests').click();
      const requests = page.getByTestId('table-cost-center-requests');
      const approveRow = requests.locator('tr', { hasText: formatCc(approveCc) });
      const rejectRow = requests.locator('tr', { hasText: formatCc(rejectCc) });
      await expect(approveRow).toBeVisible();
      await expect(rejectRow).toBeVisible();
      await shot('requests-pending');
      await approveRow.getByTestId('btn-approve-request').click();
      await expect(page.getByTestId('toast-cost-center-approved')).toBeVisible();
      await expect(approveRow).toHaveCount(0);
      await shot('request-approved');
      await rejectRow.getByTestId('btn-reject-request').click();
      const rejectDialog = page.getByTestId('dialog-reject-request');
      await expect(rejectDialog).toBeVisible();
      await rejectDialog.getByTestId('input-reject-reason').fill('Test: Kostenstelle ist nicht bekannt');
      await shot('request-reject');
      await rejectDialog.getByTestId('btn-confirm').click();
      await expect(rejectDialog).toBeHidden();
      await expect(rejectRow).toHaveCount(0);
      await shot('request-rejected');

      // --- users: actions, role, cost center admin, budget
      await page.getByTestId('nav-admin-users').click();
      await expect(page.getByTestId('page-admin-users')).toBeVisible();
      await tableLoaded(page.getByTestId('table-users'));
      await shot('users');
      await page.getByTestId('input-user-search').fill(requesterEmail);
      await page.getByTestId('btn-user-search').click();
      const userRow = page.getByTestId('table-users').locator('tr', { hasText: requesterEmail });
      await expect(userRow.getByTestId('user-cost-center')).toHaveText(formatCc(approveCc));
      await userRow.getByTestId('btn-user-actions').click();
      await expect(page.getByTestId('btn-set-role')).toBeVisible();
      await shot('user-actions');

      // role and cost center admin are only shown: changing them would grant rights to a LiteLLM test user
      await page.getByTestId('btn-set-role').click();
      const roleDialog = page.getByTestId('dialog-set-role');
      await expect(roleDialog).toBeVisible();
      await shot('user-role');
      await page.keyboard.press('Escape');
      await expect(roleDialog).toBeHidden();

      await userRow.getByTestId('btn-user-actions').click();
      await page.getByTestId('btn-set-cost-center-admin').click();
      const ccAdminDialog = page.getByTestId('dialog-cost-center-admin');
      await expect(ccAdminDialog.getByTestId('list-cost-center-admin')).toBeVisible();
      await shot('user-cost-center-admin');
      await page.keyboard.press('Escape');
      await expect(ccAdminDialog).toBeHidden();

      await userRow.getByTestId('btn-user-actions').click();
      await page.getByTestId('btn-assign-budget').click();
      const budgetDialog = page.getByTestId('dialog-assign-budget');
      await expect(budgetDialog).toBeVisible();
      await budgetDialog.getByTestId('input-budget-amount').fill('50');
      await shot('user-budget');
      await budgetDialog.getByTestId('btn-save-budget').click();
      await expect(budgetDialog).toBeHidden();
      await expect(page.getByTestId('toast-budget-saved')).toBeVisible();
      await expect(userRow.getByTestId('user-budget')).toContainText('50,00');
      await shot('user-budget-saved');

      // --- users: deactivate and reactivate
      await page.getByTestId('input-user-search').fill(rejectedEmail);
      await page.getByTestId('btn-user-search').click();
      const rejectedRow = page.getByTestId('table-users').locator('tr', { hasText: rejectedEmail });
      await expect(rejectedRow).toBeVisible();
      await rejectedRow.getByTestId('btn-user-actions').click();
      await page.getByTestId('btn-deactivate-user').click();
      const deactivate = page.getByTestId('dialog-deactivate-user');
      await expect(deactivate).toBeVisible();
      await shot('user-deactivate');
      await deactivate.getByTestId('btn-confirm').click();
      await expect(deactivate).toBeHidden();
      await expect(rejectedRow).toHaveCount(0);
      await page.getByTestId('switch-include-deactivated').click();
      await expect(rejectedRow.getByTestId('user-status')).toHaveAttribute('data-status', 'deactivated');
      await shot('user-deactivated');
      await rejectedRow.getByTestId('btn-user-actions').click();
      await page.getByTestId('btn-reactivate-user').click();
      await expect(rejectedRow.getByTestId('user-status')).toHaveAttribute('data-status', 'active');
      await shot('user-reactivated');

      // --- LiteLLM users (a proxy key without admin rights gets an error instead of rows)
      await page.getByTestId('nav-admin-litellm-users').click();
      await expect(page.getByTestId('page-admin-litellm-users')).toBeVisible();
      await page.getByTestId('input-litellm-user-search').fill(ownerEmail);
      await page.getByTestId('btn-litellm-user-search').click();
      const litellmRow = page.getByTestId('table-litellm-users').locator('tr', { hasText: ownerEmail });
      await expect(litellmRow.or(page.getByTestId('litellm-users-error')).first()).toBeVisible();
      await shot('litellm-users');

      // --- providers: sync, edit dialog (closed without saving: the model catalog is shared)
      await page.getByTestId('nav-admin-providers').click();
      await expect(page.getByTestId('page-admin-providers')).toBeVisible();
      await tableLoaded(page.getByTestId('table-providers'));
      await shot('providers');
      await page.getByTestId('btn-sync-providers').click();
      await expect(page.getByTestId('toast-providers-synced')).toBeVisible();
      await shot('providers-synced');
      await page.getByTestId('btn-edit-provider').first().click();
      const providerDialog = page.getByTestId('dialog-edit-provider');
      await expect(providerDialog).toBeVisible();
      await shot('provider-edit');
      await page.keyboard.press('Escape');
      await expect(providerDialog).toBeHidden();

      // --- reports
      await page.getByTestId('nav-admin-reports').click();
      await expect(page.getByTestId('page-admin-reports')).toBeVisible();
      const reportRow = page.getByTestId('table-reports').getByTestId('table-row').first();
      await expect(reportRow).toBeVisible();
      await shot('reports');
      await reportRow.click();
      await expect(page.getByTestId('report-detail')).toBeVisible();
      await shot('report-detail');
      await page.keyboard.press('Escape');

      // --- notifications and event log
      await page.getByTestId('nav-admin-notifications').click();
      await expect(page.getByTestId('page-admin-notifications')).toBeVisible();
      await tableLoaded(page.getByTestId('table-notifications'));
      await shot('notifications');

      await page.getByTestId('nav-admin-events').click();
      await expect(page.getByTestId('page-admin-events')).toBeVisible();
      await tableLoaded(page.getByTestId('table-events'));
      await shot('events');
      await page.getByTestId('input-event-action').fill('cost_center.create');
      const eventRow = page.getByTestId('table-events').getByTestId('table-row').first();
      await expect(eventRow.getByTestId('event-action')).toHaveText('cost_center.create');
      await eventRow.click();
      await expect(page.getByTestId('event-detail')).toBeVisible();
      await shot('event-detail');

      // --- impersonation (only with IMPERSONATION_ENABLED=true): act as the owner of the new cost center
      const me = (await (await page.request.get('/api/v1/me')).json()) as { impersonationEnabled: boolean };
      if (me.impersonationEnabled) {
        await page.getByTestId('nav-admin-users').click();
        await page.getByTestId('input-user-search').fill(ownerEmail);
        await page.getByTestId('btn-user-search').click();
        const ownerRow = page.getByTestId('table-users').locator('tr', { hasText: ownerEmail });
        await expect(ownerRow).toBeVisible();
        await ownerRow.getByTestId('btn-user-actions').click();
        await page.getByTestId('btn-impersonate-user').click();
        const confirm = page.getByTestId('dialog-impersonate-user');
        await expect(confirm).toBeVisible();
        await shot('impersonate');
        await confirm.getByTestId('btn-confirm').click();
        await expect(page.getByTestId('page-dashboard')).toBeVisible();
        await expect(page.getByTestId('impersonation-banner')).toBeVisible();
        await shot('impersonating');
        await page.getByTestId('nav-cost-centers').click();
        await expect(page.getByTestId('card-cost-center').filter({ hasText: formatCc(newCc) })).toBeVisible();
        await shot('impersonating-cost-centers');
        await page.getByTestId('btn-stop-impersonation').click();
        await expect(page.getByTestId('page-admin-users')).toBeVisible();
        await expect(page.getByTestId('impersonation-banner')).toHaveCount(0);
      }

      // --- archive the new cost center and sign out
      await page.getByTestId('nav-admin-cost-centers').click();
      await page.getByTestId('input-cc-search').fill(newCc);
      await page.getByTestId('input-cc-search').press('Enter');
      await ccRow.getByTestId('btn-archive-cost-center').click();
      const archive = page.getByTestId('dialog-archive-cost-center');
      await expect(archive).toBeVisible();
      await shot('cost-center-archive');
      await archive.getByTestId('btn-confirm').click();
      await expect(archive).toBeHidden();
      await expect(ccRow.getByTestId('cc-status')).toHaveAttribute('data-status', 'archived');
      await shot('cost-center-archived');

      await page.getByTestId('btn-user-menu').click();
      await page.getByTestId('btn-logout').click();
      await expect(page).toHaveURL(/\/login/);
    } finally {
      for (const c of [owner, member, requester, rejected]) await c.api.dispose();
    }
  });
});
