import { expect, test, type Page } from '@playwright/test';
import { RUN } from '../env';
import { cleanup, created, getKey, getTeam, keyExists, TEAM_ADMIN_ROLE, teamRole } from '../litellm-admin';
import { expectMail } from '../mailpit';
import { ccPattern, expectTeamAdminWarning, json, liveUser, pickPricedModel, uniqueCostCenterNumber, type LiveUser } from '../support';

/**
 * The main flows through the UI against a live LiteLLM proxy (plan decision e = both).
 * After each UI action the LiteLLM side is checked with the master key.
 */

test.describe.configure({ mode: 'serial' });

const formatCc = (n: string) => `${n.slice(0, 4)} ${n.slice(4)}`;

async function signIn(page: Page, u: LiveUser, admin = false) {
  await page.goto('/login');
  await page.getByTestId('input-dev-email').fill(u.email);
  await page.getByTestId('input-dev-name').fill(u.name);
  if (admin) await page.getByTestId('checkbox-dev-admin').check();
  await page.getByTestId('btn-dev-login').click();
  await expect(page.getByTestId('page-dashboard')).toBeVisible({ timeout: 15_000 });
}

let admin: LiveUser;
let owner: LiveUser;
let member: LiveUser;
let model: string;
let ccNumber: string;
let ccId: string;

test.beforeAll(async () => {
  admin = await liveUser('ui-admin', { admin: true });
  owner = await liveUser('ui-owner');
  member = await liveUser('ui-member');
  model = await pickPricedModel(admin.api);
  ccNumber = uniqueCostCenterNumber();
});

test.afterAll(async () => {
  const errors = await cleanup();
  for (const u of [admin, owner, member]) await u?.api.dispose();
  expect(errors, 'LiteLLM cleanup').toEqual([]);
});

test('admin approves a cost center request in the UI; LiteLLM team is created', async ({ page }) => {
  const r = await owner.api.post('/api/v1/cost-centers', { data: { number: ccNumber, name: `test ${RUN} ui`, ownerEmail: owner.email } });
  expect(r.status(), await r.text()).toBe(201);
  ccId = ((await r.json()) as { costCenter: { id: string } }).costCenter.id;

  await signIn(page, admin, true);
  await page.getByTestId('nav-admin-cost-centers').click();
  await page.getByTestId('tab-requests').click();
  const row = page.getByTestId('table-cost-center-requests').locator('tr', { hasText: formatCc(ccNumber) });
  await row.getByTestId('btn-approve-request').click();
  await expect(page.getByTestId('toast-cost-center-approved')).toBeVisible();
  created.teams.add(ccId);

  await expect.poll(async () => (await getTeam(ccId))?.alias ?? null).toContain(ccNumber);
  expect(await teamRole(ccId, owner.id)).toBe(TEAM_ADMIN_ROLE);
  await expectMail(owner.email, new RegExp(`(Kostenstelle ${ccPattern(ccNumber)} freigegeben|Cost center ${ccPattern(ccNumber)} approved)`));
});

test('owner adds a member, promotes and demotes them in the UI; LiteLLM follows', async ({ page }) => {
  await signIn(page, owner);
  await page.getByTestId('nav-cost-centers').click();
  await page
    .getByTestId('card-cost-center')
    .filter({ hasText: formatCc(ccNumber) })
    .getByTestId('btn-cost-center-members')
    .click();
  const sheet = page.getByTestId('sheet-cost-center-members');

  await sheet.getByTestId('input-member-search').fill(member.email);
  await sheet.getByTestId('btn-member-search').click();
  await sheet.getByTestId('item-member-candidate').filter({ hasText: member.email }).getByTestId('btn-add-member').click();
  const row = sheet.locator(`[data-testid="row-member"][data-user-id="${member.id}"]`);
  await expect(row).toBeVisible();
  await expect.poll(() => teamRole(ccId, member.id)).toBe('user');

  await row.getByTestId('input-member-role').click();
  await page.getByRole('option').filter({ hasText: /admin/i }).click();
  await expect.poll(() => teamRole(ccId, member.id)).toBe(TEAM_ADMIN_ROLE);
  await expectTeamAdminWarning(admin.api, ccId, member.id);

  await row.getByTestId('input-member-role').click();
  await page
    .getByRole('option')
    .filter({ hasText: /^(Mitglied|Member|User)$/i })
    .click();
  await expect.poll(() => teamRole(ccId, member.id)).toBe('user');
});

test('member creates a key on the cost center in the UI and gets a real answer from the key test', async ({ page }) => {
  await signIn(page, member);
  await page.getByTestId('nav-keys').click();
  await page.getByTestId('btn-create-key').click();
  const dialog = page.getByTestId('dialog-create-key');
  await dialog.getByTestId('input-key-name').fill(`test ${RUN} ui`);
  await dialog.getByTestId('input-key-cost-center').click();
  await page
    .getByRole('option')
    .filter({ hasText: `test ${RUN} ui` })
    .click();
  // the filter opens the matching provider group (#9)
  await dialog.getByTestId('input-key-models-filter').fill(model);
  await dialog.getByTestId('list-models').locator('label', { hasText: model }).first().click();
  await dialog.getByTestId('btn-submit-create-key').click();

  const secretDialog = page.getByTestId('dialog-key-secret');
  const secret = ((await secretDialog.getByTestId('key-secret').textContent()) ?? '').trim();
  expect(secret).toMatch(/^sk-/);
  created.keys.add(secret);
  await secretDialog.getByTestId('btn-close-secret').click();
  expect(await getKey(secret)).toMatchObject({ teamId: ccId, userId: member.id, blocked: false });

  await page.getByTestId('nav-key-test').click();
  await page.getByTestId('input-key-test-key').fill(secret);
  await page.getByTestId('btn-load-models').click();
  await expect(page.getByTestId('input-key-test-model')).toBeVisible();
  await page.getByTestId('btn-send-key-test').click();
  await expect(page.getByTestId('key-test-success')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('key-test-answer')).not.toBeEmpty();
});

test('owner removes the member in the UI; the key is deleted in LiteLLM', async ({ page }) => {
  const keys = await json<{ items: { id: string }[] }>(member.api.get('/api/v1/api-keys'));
  expect(keys.items.length).toBe(1);
  const secret = [...created.keys][0]!;

  await signIn(page, owner);
  await page.getByTestId('nav-cost-centers').click();
  await page
    .getByTestId('card-cost-center')
    .filter({ hasText: formatCc(ccNumber) })
    .getByTestId('btn-cost-center-members')
    .click();
  const sheet = page.getByTestId('sheet-cost-center-members');
  const row = sheet.locator(`[data-testid="row-member"][data-user-id="${member.id}"]`);
  await row.getByTestId('btn-remove-member').click();
  await page.getByTestId('dialog-remove-member').getByTestId('btn-confirm').click();
  await expect(row).toHaveCount(0);

  await expect.poll(() => teamRole(ccId, member.id)).toBeNull();
  expect(await keyExists(secret), 'LiteLLM key deleted').toBe(false);
  expect((await json<{ items: unknown[] }>(member.api.get('/api/v1/api-keys'))).items).toEqual([]);
});

test('admin deactivates the member in the UI; the login is locked', async ({ page }) => {
  await signIn(page, admin, true);
  await page.getByTestId('nav-admin-users').click();
  await page.getByTestId('input-user-search').fill(member.email);
  await page.getByTestId('btn-user-search').click();
  const row = page.getByTestId('table-users').locator('tr', { hasText: member.email });
  await row.getByTestId('btn-user-actions').click();
  await page.getByTestId('btn-deactivate-user').click();
  await page.getByTestId('dialog-deactivate-user').getByTestId('btn-confirm').click();

  await expect.poll(async () => (await member.api.get('/api/v1/me')).status()).toBe(403);
});
