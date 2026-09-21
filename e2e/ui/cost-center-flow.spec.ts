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

    // --- user: request cost center via profile
    const user = await newPage(browser);
    await devLogin(user.page, { email: userEmail, name: 'Flow User' });
    await user.page.getByTestId('btn-user-menu').click();
    await user.page.getByTestId('nav-profile').click();
    await expect(user.page.getByTestId('page-profile')).toBeVisible();
    await expect(user.page.getByTestId('input-cost-center')).toHaveValue('1111 1111');
    await user.page.getByTestId('input-cost-center').fill(cc);
    await expect(user.page.getByTestId('input-cost-center')).toHaveValue(ccFormatted);
    await user.page.getByTestId('input-owner-name').fill('Prof. Owner');
    await user.page.getByTestId('input-owner-email').fill('owner@example.org');
    await user.page.getByTestId('btn-save-profile').click();
    await expect(user.page.getByTestId('toast-request-created')).toBeVisible();
    await expect(user.page.getByTestId('request-status')).toHaveAttribute('data-status', 'pending');

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

    // --- user: sees the approved cost center and the budget
    await user.page.reload();
    await expect(user.page.getByTestId('input-cost-center')).toHaveValue(ccFormatted);
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
