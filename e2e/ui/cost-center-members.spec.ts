import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { devLogin, formatCc, uniqueCostCenter, uniqueEmail } from './helpers';

const API = 'http://localhost:3030';
const ORIGIN = { Origin: 'http://localhost:5173' };

/** Separate API session (own cookie jar); returns the context and the user id. Names start with "test" for real proxies. */
async function apiLogin(data: { email: string; name: string; admin?: boolean }): Promise<{ api: APIRequestContext; id: string }> {
  const api = await playwrightRequest.newContext({ baseURL: API, extraHTTPHeaders: ORIGIN });
  const login = await api.post('/api/auth/dev-login', { data });
  expect(login.status(), await login.text()).toBe(200);
  return { api, id: ((await (await api.get('/api/v1/me')).json()) as { id: string }).id };
}

/** F-KST-10/11: a cost center admin adds a known LiteLLM user, makes them second admin and removes them again. */
test.describe('cost center members', () => {
  test('cost center admin adds a member, promotes and removes them', async ({ page, browser }) => {
    const ccAdminEmail = uniqueEmail('test-cc-admin');
    const memberEmail = uniqueEmail('test-cc-member');
    const cc = uniqueCostCenter();

    // Setup: signing in makes both users known to LiteLLM; an admin creates the cost center with the cost center admin as owner (F-KST-14).
    const root = await apiLogin({ email: uniqueEmail('test-cc-root'), name: 'Test Root Admin', admin: true });
    const ccAdmin = await apiLogin({ email: ccAdminEmail, name: 'Test Cc Admin' });
    const member = await apiLogin({ email: memberEmail, name: 'Test Member' });
    const created = await root.api.post('/api/v1/admin/cost-centers', { data: { number: cc, name: 'Test Members', ownerUserId: ccAdmin.id } });
    expect(created.status(), await created.text()).toBe(201);
    const ccId = ((await created.json()) as { id: string }).id;

    await devLogin(page, { email: ccAdminEmail, name: 'Test Cc Admin' });
    await page.getByTestId('nav-cost-centers').click();
    await page
      .getByTestId('card-cost-center')
      .filter({ hasText: formatCc(cc) })
      .getByTestId('btn-cost-center-members')
      .click();
    const sheet = page.getByTestId('sheet-cost-center-members');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('row-member')).toHaveCount(1);
    await expect(sheet.getByTestId('badge-member-owner')).toBeVisible();

    // add the member
    await sheet.getByTestId('input-member-search').fill(memberEmail);
    await sheet.getByTestId('btn-member-search').click();
    await sheet.getByTestId('item-member-candidate').filter({ hasText: memberEmail }).getByTestId('btn-add-member').click();
    const memberRow = sheet.locator(`[data-testid="row-member"][data-user-id="${member.id}"]`);
    await expect(memberRow).toBeVisible();
    await expect(memberRow.getByTestId('member-status')).toHaveAttribute('data-status', 'active');
    const me = (await (await member.api.get('/api/v1/me')).json()) as { costCenter: { id: string }; managedCostCenters: { id: string }[] };
    expect(me.costCenter.id).toBe(ccId);
    expect(me.managedCostCenters).toEqual([]);

    // promote to second cost center admin
    await memberRow.getByTestId('input-member-role').click();
    await page.getByRole('option').filter({ hasText: /admin/i }).click();
    await expect.poll(async () => ((await (await member.api.get('/api/v1/me')).json()) as typeof me).managedCostCenters.map((c) => c.id)).toEqual([ccId]);

    // F-KST-13: the new admin is not the owner, so they add plain members only and cannot change roles
    const memberPage = await browser.newPage();
    await devLogin(memberPage, { email: memberEmail, name: 'Test Member' });
    await memberPage.getByTestId('nav-cost-centers').click();
    await memberPage
      .getByTestId('card-cost-center')
      .filter({ hasText: formatCc(cc) })
      .getByTestId('btn-cost-center-members')
      .click();
    const memberSheet = memberPage.getByTestId('sheet-cost-center-members');
    await expect(memberSheet.getByTestId('input-member-search')).toBeVisible();
    await expect(memberSheet.getByTestId('input-new-member-role')).toHaveCount(0);
    for (const select of await memberSheet.getByTestId('input-member-role').all()) await expect(select).toBeDisabled();
    await memberPage.close();

    // remove again
    await memberRow.getByTestId('btn-remove-member').click();
    await page.getByTestId('dialog-remove-member').getByTestId('btn-confirm').click();
    await expect(memberRow).toHaveCount(0);
    expect(((await (await member.api.get('/api/v1/me')).json()) as typeof me).costCenter.id).not.toBe(ccId);

    for (const c of [root, ccAdmin, member]) await c.api.dispose();
  });

  /** Bulk add: pasted addresses are resolved, unknown and invalid ones are listed, found users are added at once. */
  test('cost center admin adds several members from a pasted list', async ({ page }) => {
    const ccAdminEmail = uniqueEmail('test-bulk-admin');
    const a = uniqueEmail('test-bulk-a');
    const b = uniqueEmail('test-bulk-b');
    const unknown = uniqueEmail('test-bulk-unknown');
    const cc = uniqueCostCenter();

    const root = await apiLogin({ email: uniqueEmail('test-bulk-root'), name: 'Test Root Admin', admin: true });
    const ccAdmin = await apiLogin({ email: ccAdminEmail, name: 'Test Bulk Admin' });
    const ua = await apiLogin({ email: a, name: 'Test Bulk A' });
    const ub = await apiLogin({ email: b, name: 'Test Bulk B' });
    const created = await root.api.post('/api/v1/admin/cost-centers', { data: { number: cc, name: 'Test Bulk', ownerUserId: ccAdmin.id } });
    expect(created.status(), await created.text()).toBe(201);

    await devLogin(page, { email: ccAdminEmail, name: 'Test Bulk Admin' });
    await page.getByTestId('nav-cost-centers').click();
    await page
      .getByTestId('card-cost-center')
      .filter({ hasText: formatCc(cc) })
      .getByTestId('btn-cost-center-members')
      .click();
    const sheet = page.getByTestId('sheet-cost-center-members');
    await sheet.getByTestId('btn-bulk-add-members').click();

    const dialog = page.getByTestId('dialog-bulk-add-members');
    await dialog.getByTestId('input-bulk-emails').fill(`Test Bulk A <${a}>; ${b}, ${unknown}\nkeine-adresse`);
    await dialog.getByTestId('btn-bulk-resolve').click();
    await expect(dialog.getByTestId('item-bulk-found')).toHaveCount(2);
    await expect(dialog.getByTestId('bulk-not-found-list')).toHaveText(unknown);
    await expect(dialog.getByTestId('bulk-invalid')).toContainText('keine-adresse');
    await dialog.getByTestId('btn-bulk-add').click();
    await expect(dialog).toBeHidden();
    await expect(sheet.getByTestId('row-member')).toHaveCount(3);

    for (const c of [root, ccAdmin, ua, ub]) await c.api.dispose();
  });

  /** F-KST-16: a user asks to join; the cost center admin sees the badge and approves, a second request is rejected. */
  test('cost center admin approves and rejects join requests', async ({ page }) => {
    const ccAdminEmail = uniqueEmail('test-cc-join-admin');
    const cc = uniqueCostCenter();
    const root = await apiLogin({ email: uniqueEmail('test-cc-join-root'), name: 'Test Root Admin', admin: true });
    const ccAdmin = await apiLogin({ email: ccAdminEmail, name: 'Test Cc Admin' });
    const joiner = await apiLogin({ email: uniqueEmail('test-cc-joiner'), name: 'Test Joiner' });
    const other = await apiLogin({ email: uniqueEmail('test-cc-joiner2'), name: 'Test Other Joiner' });
    const created = await root.api.post('/api/v1/admin/cost-centers', { data: { number: cc, name: 'Test Join', ownerUserId: ccAdmin.id } });
    expect(created.status(), await created.text()).toBe(201);
    const ccId = ((await created.json()) as { id: string }).id;
    for (const u of [joiner, other]) {
      const r = await u.api.post('/api/v1/me/join-requests', { data: { costCenterId: ccId, message: 'Projekt KI' } });
      expect(r.status(), await r.text()).toBe(201);
    }

    await devLogin(page, { email: ccAdminEmail, name: 'Test Cc Admin' });
    await page.getByTestId('nav-cost-centers').click();
    const card = page.getByTestId('card-cost-center').filter({ hasText: formatCc(cc) });
    await expect(card.getByTestId('badge-open-join-requests')).toHaveText('2');
    await card.getByTestId('btn-cost-center-members').click();
    const sheet = page.getByTestId('sheet-cost-center-members');
    await expect(sheet.getByTestId('item-join-request')).toHaveCount(2);

    await sheet.getByTestId('item-join-request').filter({ hasText: 'Test Joiner' }).getByTestId('btn-approve-join-request').click();
    await expect(sheet.locator(`[data-testid="row-member"][data-user-id="${joiner.id}"]`)).toBeVisible();

    await sheet.getByTestId('item-join-request').filter({ hasText: 'Test Other Joiner' }).getByTestId('btn-reject-join-request').click();
    const dialog = page.getByTestId('dialog-reject-join-request');
    await dialog.getByTestId('input-join-reject-reason').fill('Nicht im Projekt');
    await dialog.getByTestId('btn-confirm').click();
    await expect(sheet.getByTestId('join-requests-empty')).toBeVisible();
    await expect(card.getByTestId('badge-open-join-requests')).toHaveCount(0);

    for (const c of [root, ccAdmin, joiner, other]) await c.api.dispose();
  });
});
