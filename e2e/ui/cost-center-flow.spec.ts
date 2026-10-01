import { expect, test, type Browser } from '@playwright/test';
import { devLogin, formatCc, uniqueCostCenter, uniqueEmail } from './helpers';

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ locale: 'de-DE' });
  return { ctx, page: await ctx.newPage() };
}

test.describe('cost center request, approval and budget assignment', () => {
  test('user requests a cost center, admin approves it and assigns a budget', async ({ browser }) => {
    const userEmail = uniqueEmail('flow');
    const adminEmail = uniqueEmail('admin');
    const cc = uniqueCostCenter();
    const ccFormatted = formatCc(cc);

    // --- user: the profile has no cost center; the request goes through the API
    const user = await newPage(browser);
    await devLogin(user.page, { email: userEmail, name: 'Flow User' });
    await user.page.getByTestId('btn-user-menu').click();
    await user.page.getByTestId('nav-profile').click();
    await expect(user.page.getByTestId('page-profile')).toBeVisible();
    await expect(user.page.getByTestId('input-cost-center')).toHaveCount(0);
    const origin = new URL(user.page.url()).origin;
    const req = await user.page.request.patch('/api/v1/me', {
      // the owner must be a LiteLLM user (F-KST-14); the requester is one
      data: { costCenterNumber: cc, costCenterOwnerName: 'Flow User', costCenterOwnerEmail: userEmail },
      headers: { Origin: origin },
    });
    expect(req.status(), await req.text()).toBe(200);
    expect((await req.json()).pendingRequest).toMatchObject({ number: cc, status: 'pending' });

    // --- admin: approve the request
    const admin = await newPage(browser);
    await devLogin(admin.page, { email: adminEmail, name: 'Flow Admin', admin: true });
    await expect(admin.page.getByTestId('nav-admin-users')).toBeVisible();
    await admin.page.getByTestId('nav-admin-cost-centers').click();
    await admin.page.getByTestId('tab-requests').click();
    const reqRow = admin.page.getByTestId('table-cost-center-requests').locator('tr', { hasText: ccFormatted });
    await expect(reqRow).toBeVisible();
    await reqRow.getByTestId('btn-approve-request').click();
    await expect(admin.page.getByTestId('toast-cost-center-approved')).toBeVisible();
    await expect(admin.page.getByTestId('table-cost-center-requests').locator('tr', { hasText: ccFormatted })).toHaveCount(0);

    // lookup now contains the approved cost center
    await admin.page.getByTestId('tab-lookup').click();
    await admin.page.getByTestId('input-cc-search').fill(cc);
    await admin.page.getByTestId('input-cc-search').press('Enter');
    const ccRow = admin.page.getByTestId('table-cost-centers').locator('tr', { hasText: ccFormatted });
    await expect(ccRow).toBeVisible();
    await expect(ccRow.getByTestId('cc-status')).toHaveAttribute('data-status', 'approved');

    // --- admin: assign a budget to the user
    await admin.page.getByTestId('nav-admin-users').click();
    await admin.page.getByTestId('input-user-search').fill(userEmail);
    await admin.page.getByTestId('btn-user-search').click();
    const userRow = admin.page.getByTestId('table-users').locator('tr', { hasText: userEmail });
    await expect(userRow).toBeVisible();
    await expect(userRow.getByTestId('user-cost-center')).toHaveText(ccFormatted);
    await userRow.getByTestId('btn-user-actions').click();
    await admin.page.getByTestId('btn-assign-budget').click();
    const budgetDialog = admin.page.getByTestId('dialog-assign-budget');
    await expect(budgetDialog).toBeVisible();
    await budgetDialog.getByTestId('input-budget-amount').fill('50');
    await budgetDialog.getByTestId('btn-save-budget').click();
    await expect(budgetDialog).toBeHidden();
    await expect(admin.page.getByTestId('toast-budget-saved')).toBeVisible();
    await expect(userRow.getByTestId('user-budget')).toContainText('50,00');

    // --- user: has the approved cost center and sees the budget
    expect((await (await user.page.request.get('/api/v1/me')).json()).costCenter.number).toBe(cc);
    await user.page.reload();
    await user.page.getByTestId('nav-dashboard').click();
    await expect(user.page.getByTestId('stat-budget')).toContainText('50,00');

    await user.ctx.close();
    await admin.ctx.close();
  });

  test('non-admin is redirected away from admin routes', async ({ page }) => {
    await devLogin(page, { email: uniqueEmail('plain'), name: 'Plain User' });
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('page-dashboard')).toBeVisible();
  });
});
