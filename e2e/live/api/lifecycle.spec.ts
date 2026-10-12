import { expect, test } from '@playwright/test';
import { RUN } from '../env';
import { chatDirect, cleanup, created, getKey, getTeam, getUser, keyExists, TEAM_ADMIN_ROLE, teamRole } from '../litellm-admin';
import { expectMail } from '../mailpit';
import { ccPattern, createKey, expectError, expectTeamAdminWarning, ingestUntil, json, keyStatus, liveUser, pickPricedModel, relogin, uniqueCostCenterNumber, type LiveUser } from '../support';

/**
 * Full lifecycle against a live LiteLLM proxy (docs/plans/e2e_live_litellm_plan.md).
 * Every step checks API-Selfservice and the LiteLLM side (master key) and, where a mail is sent, Mailpit.
 * Serial: each block builds on the state of the previous one.
 */

test.describe.configure({ mode: 'serial' });

const SUBJ = {
  approved: (n: string) => new RegExp(`(Kostenstelle ${ccPattern(n)} freigegeben|Cost center ${ccPattern(n)} approved)`),
  rejected: (n: string) => new RegExp(`(Kostenstelle ${ccPattern(n)} abgelehnt|Cost center ${ccPattern(n)} rejected)`),
  added: (n: string) => new RegExp(`${ccPattern(n)}: (Sie wurden hinzugefügt|you were added)`),
  removed: (n: string) => new RegExp(`${ccPattern(n)}: (Mitgliedschaft beendet|membership ended)`),
  joinCreated: (n: string) => new RegExp(`${ccPattern(n)}: (Beitrittsanfrage von|join request from)`),
  joinRejected: (n: string) => new RegExp(`${ccPattern(n)}: (Beitritt abgelehnt|join request rejected)`),
  ccBudget100: (n: string) => new RegExp(`${ccPattern(n)}: (Budget erschöpft|budget exhausted)`),
  userBudget100: /^(Budget erschöpft|Budget exhausted)$/,
  roleChanged: /(Ihre Rolle wurde geändert|Your role was changed)/,
  deactivated: /(Account deaktiviert|Account deactivated)/,
};

const TINY = 0.000001; // EUR; one real request exceeds it

let admin: LiveUser; // A1, global admin
let requester: LiveUser; // U1, requests the cost center, becomes member
let owner: LiveUser; // U2, owner and cost center admin
let member: LiveUser; // U3, added, promoted, demoted, removed, re-added
let joiner: LiveUser; // U4, join requests
let bulk: LiveUser; // U5, bulk-added, global role, deactivated
let outsider: LiveUser; // U6, deactivated before being added
let model: string;
let ccNumber: string;
let ccId: string;
let memberKey: { id: string; secret: string };
let requesterKey: { id: string; secret: string };
let bulkKey: { id: string; secret: string };

test.beforeAll(async () => {
  admin = await liveUser('admin', { admin: true });
  requester = await liveUser('requester');
  owner = await liveUser('owner');
  member = await liveUser('member');
  joiner = await liveUser('joiner');
  bulk = await liveUser('bulk');
  outsider = await liveUser('outsider');
  ccNumber = uniqueCostCenterNumber();
  model = await pickPricedModel(admin.api);
});

test.afterAll(async () => {
  const errors = await cleanup();
  for (const u of [admin, requester, owner, member, joiner, bulk, outsider]) await u?.api.dispose();
  expect(errors, 'LiteLLM cleanup').toEqual([]);
});

test('API runs against the live LiteLLM proxy and every user exists there', async ({ request }) => {
  const health = await json<{ ok: boolean; mode: string }>(request.get('/health'));
  expect(health.mode, 'start the API with LITELLM_MODE=http').toBe('http');
  for (const u of [admin, requester, owner, member, joiner, bulk, outsider]) expect(await getUser(u.id), u.email).not.toBeNull();
});

test.describe('1. cost center request and approval (F-KST-2/3/14)', () => {
  test('owner unknown to LiteLLM is refused', async () => {
    await expectError(requester.api.patch('/api/v1/me', { data: { costCenterNumber: uniqueCostCenterNumber(), costCenterOwnerEmail: `nobody-${RUN}@example.com` } }), 409, 'OWNER_NOT_LITELLM_USER');
  });

  test('admin rejects a request with a reason; requester gets a mail', async () => {
    const number = uniqueCostCenterNumber();
    const req = await json(joiner.api.post('/api/v1/cost-centers', { data: { number, name: `test ${RUN} rejected`, ownerEmail: joiner.email } }), 201);
    expect(req.status).toBe('pending');
    expect(await getTeam(req.costCenter.id), 'no LiteLLM team before approval').toBeNull();
    const rejected = await json(admin.api.post(`/api/v1/cost-center-requests/${req.id}/reject`, { data: { reason: 'Test rejection' } }));
    expect(rejected).toMatchObject({ status: 'rejected', reason: 'Test rejection' });
    expect(await getTeam(req.costCenter.id)).toBeNull();
    await expectMail(joiner.email, SUBJ.rejected(number));
  });

  test('requester asks for a cost center with another owner; admin approves; LiteLLM team is created', async () => {
    const me = await json(requester.api.patch('/api/v1/me', { data: { costCenterNumber: ccNumber, costCenterOwnerName: owner.name, costCenterOwnerEmail: owner.email } }));
    expect(me.pendingRequest).toMatchObject({ number: ccNumber, status: 'pending' });
    expect(me.costCenter.number).toBe('11111111');

    const pending = await json(admin.api.get('/api/v1/cost-center-requests?status=pending&pageSize=200'));
    const req = pending.items.find((r: { costCenter: { number: string } }) => r.costCenter.number === ccNumber);
    expect(req).toBeDefined();
    ccId = req.costCenter.id;
    expect(await getTeam(ccId)).toBeNull();

    expect((await json(admin.api.post(`/api/v1/cost-center-requests/${req.id}/approve`))).status).toBe('approved');
    created.teams.add(ccId);

    const team = await getTeam(ccId);
    expect(team, 'LiteLLM team').not.toBeNull();
    expect(team!.alias).toContain(ccNumber);
    expect(team!.metadata.cost_center).toBe(ccNumber);
    expect(await teamRole(ccId, owner.id)).toBe(TEAM_ADMIN_ROLE);
    expect(await teamRole(ccId, requester.id)).toBe('user');

    const after = await json(requester.api.get('/api/v1/me'));
    expect(after.costCenter.id).toBe(ccId);
    expect((await json(owner.api.get('/api/v1/me'))).managedCostCenters.map((c: { id: string }) => c.id)).toEqual([ccId]);
    await expectMail(requester.email, SUBJ.approved(ccNumber));
  });
});

test.describe('2. members and keys (F-KST-10/11/12)', () => {
  test('owner finds and adds a member; LiteLLM team member with role user', async () => {
    const candidates = await json(owner.api.get(`/api/v1/cost-centers/${ccId}/member-candidates?q=${encodeURIComponent(member.email)}`));
    expect(candidates).toEqual([expect.objectContaining({ userId: member.id, hasAccount: true, isMember: false })]);
    const added = await json(owner.api.post(`/api/v1/cost-centers/${ccId}/members`, { data: { userId: member.id } }), 201);
    expect(added).toMatchObject({ userId: member.id, role: 'user', status: 'active' });
    expect(await teamRole(ccId, member.id)).toBe('user');
    await expectMail(member.email, SUBJ.added(ccNumber));
    await expectError(owner.api.post(`/api/v1/cost-centers/${ccId}/members`, { data: { userId: member.id } }), 409, 'COST_CENTER_MEMBER_EXISTS');
  });

  test('bulk add resolves found, unknown and invalid entries and reports failures per user', async () => {
    const unknown = `unknown-${RUN}@example.com`;
    const resolved = await json(owner.api.post(`/api/v1/cost-centers/${ccId}/member-candidates/resolve`, { data: { emails: [bulk.email, unknown, 'no-address'] } }));
    expect(resolved.found.map((f: { userId: string }) => f.userId)).toEqual([bulk.id]);
    expect(resolved.notFound).toEqual([unknown]);
    expect(resolved.invalid).toEqual(['no-address']);
    const result = await json(owner.api.post(`/api/v1/cost-centers/${ccId}/members/bulk`, { data: { userIds: [bulk.id, member.id] } }));
    expect(result.added.map((m: { userId: string }) => m.userId)).toEqual([bulk.id]);
    expect(result.failed).toEqual([{ userId: member.id, code: 'COST_CENTER_MEMBER_EXISTS' }]);
    expect(await teamRole(ccId, bulk.id)).toBe('user');
  });

  test('members create keys on the cost center; LiteLLM keys carry the team', async () => {
    memberKey = await createKey(member, { costCenterId: ccId, models: [model] });
    requesterKey = await createKey(requester, { costCenterId: ccId, models: [model] });
    bulkKey = await createKey(bulk, { costCenterId: ccId, models: [model] });
    for (const [k, u] of [
      [memberKey, member],
      [requesterKey, requester],
      [bulkKey, bulk],
    ] as const) {
      const info = await getKey(k.secret);
      expect(info).toMatchObject({ teamId: ccId, userId: u.id, blocked: false });
      expect(info.models).toContain(model);
    }
  });

  test('a non-member cannot create a key on the cost center', async () => {
    await expectError(joiner.api.post('/api/v1/api-keys', { data: { name: `test ${RUN}`, models: [model], costCenterId: ccId } }), 409, 'COST_CENTER_NOT_MEMBER');
  });
});

test.describe('3. cost center admins and global role (F-KST-13/14, F-USR-1a)', () => {
  test('owner promotes a member to cost center admin', async () => {
    expect((await json(owner.api.patch(`/api/v1/cost-centers/${ccId}/members/${member.id}`, { data: { role: 'admin' } }))).role).toBe('admin');
    expect(await teamRole(ccId, member.id)).toBe(TEAM_ADMIN_ROLE);
    await expectTeamAdminWarning(admin.api, ccId, member.id);
    const managed = await json(member.api.get('/api/v1/cost-centers/managed'));
    expect(managed.items.map((c: { id: string }) => c.id)).toEqual([ccId]);
    expect((await json(member.api.get('/api/v1/me'))).effectiveRole).toBe('cost_center_admin');
  });

  test('a cost center admin who is not the owner cannot change roles', async () => {
    await expectError(member.api.patch(`/api/v1/cost-centers/${ccId}/members/${bulk.id}`, { data: { role: 'admin' } }), 403, 'COST_CENTER_OWNER_ONLY');
    expect(await teamRole(ccId, bulk.id)).toBe('user');
  });

  test('owner demotes the admin again', async () => {
    expect((await json(owner.api.patch(`/api/v1/cost-centers/${ccId}/members/${member.id}`, { data: { role: 'user' } }))).role).toBe('user');
    expect(await teamRole(ccId, member.id)).toBe('user');
    expect((await json(member.api.get('/api/v1/me'))).managedCostCenters).toEqual([]);
    expect((await member.api.get('/api/v1/cost-centers/managed')).status()).toBe(403);
  });

  test('the owner can neither be removed nor demoted, not even by an admin', async () => {
    await expectError(admin.api.delete(`/api/v1/cost-centers/${ccId}/members/${owner.id}`), 409, 'COST_CENTER_OWNER_MUST_BE_ADMIN');
    await expectError(admin.api.patch(`/api/v1/cost-centers/${ccId}/members/${owner.id}`, { data: { role: 'user' } }), 409, 'COST_CENTER_OWNER_MUST_BE_ADMIN');
    expect(await teamRole(ccId, owner.id)).toBe(TEAM_ADMIN_ROLE);
  });

  test('admin assigns and withdraws a cost center admin in user management', async () => {
    const set = await json(admin.api.put(`/api/v1/admin/users/${bulk.id}/cost-center-admin`, { data: { costCenterIds: [ccId] } }));
    expect(set.managedCostCenters.map((c: { id: string }) => c.id)).toEqual([ccId]);
    expect(await teamRole(ccId, bulk.id)).toBe(TEAM_ADMIN_ROLE);
    const unset = await json(admin.api.put(`/api/v1/admin/users/${bulk.id}/cost-center-admin`, { data: { costCenterIds: [] } }));
    expect(unset.managedCostCenters).toEqual([]);
    // taken off as admin, the user stays a member
    expect(await teamRole(ccId, bulk.id)).toBe('user');
  });

  test('admin makes a user a global admin and back', async () => {
    expect((await bulk.api.get('/api/v1/admin/users')).status()).toBe(403);
    expect((await json(admin.api.patch(`/api/v1/admin/users/${bulk.id}/role`, { data: { role: 'admin' } }))).role).toBe('admin');
    expect((await bulk.api.get('/api/v1/admin/users')).status()).toBe(200);
    await expectMail(bulk.email, SUBJ.roleChanged);
    expect((await json(admin.api.patch(`/api/v1/admin/users/${bulk.id}/role`, { data: { role: 'user' } }))).role).toBe('user');
    expect((await bulk.api.get('/api/v1/admin/users')).status()).toBe(403);
  });
});

test.describe('4. removing a member (F-KST-12)', () => {
  test('removal takes the user out of the LiteLLM team and deletes their keys there', async () => {
    expect((await json(member.api.get('/api/v1/me'))).costCenter.id).toBe(ccId);
    await json(owner.api.delete(`/api/v1/cost-centers/${ccId}/members/${member.id}`));
    expect(await teamRole(ccId, member.id)).toBeNull();
    expect(await keyExists(memberKey.secret), 'LiteLLM key deleted').toBe(false);
    expect(await keyStatus(member, memberKey.id), 'key gone from the key list').toBeNull();
    expect((await json(member.api.get('/api/v1/me'))).costCenter.number).toBe('11111111');
    await expectMail(member.email, SUBJ.removed(ccNumber));
    expect(await chatDirect(memberKey.secret, model), 'LiteLLM refuses the deleted key').toBeGreaterThanOrEqual(400);
  });

  test('adding the user again lets them create a new key; the old one stays deleted', async () => {
    await json(owner.api.post(`/api/v1/cost-centers/${ccId}/members`, { data: { userId: member.id } }), 201);
    expect(await teamRole(ccId, member.id)).toBe('user');
    expect(await keyStatus(member, memberKey.id)).toBeNull();
    memberKey = await createKey(member, { costCenterId: ccId, models: [model] });
    expect((await getKey(memberKey.secret)).teamId).toBe(ccId);
  });
});

test.describe('5. join requests (F-KST-16)', () => {
  let defaultCcId: string;

  test('join requests are refused for the default cost center and when one is pending', async () => {
    defaultCcId = (await json(joiner.api.get('/api/v1/me'))).costCenter.id;
    expect((await joiner.api.post('/api/v1/me/join-requests', { data: { costCenterId: defaultCcId } })).status()).toBeGreaterThanOrEqual(400);
    const req = await json(joiner.api.post('/api/v1/me/join-requests', { data: { costCenterId: ccId, message: `test ${RUN}` } }), 201);
    expect(req.status).toBe('pending');
    await expectError(joiner.api.post('/api/v1/me/join-requests', { data: { costCenterId: ccId } }), 409, 'COST_CENTER_JOIN_REQUEST_PENDING');
    await expectMail(owner.email, SUBJ.joinCreated(ccNumber));
  });

  test('owner rejects with a reason; the requester gets a mail', async () => {
    const [req] = await json(owner.api.get(`/api/v1/cost-centers/${ccId}/join-requests?status=pending`));
    expect(req.user.id).toBe(joiner.id);
    const rejected = await json(owner.api.post(`/api/v1/cost-centers/${ccId}/join-requests/${req.id}/reject`, { data: { reason: 'Not in project' } }));
    expect(rejected).toMatchObject({ status: 'rejected', reason: 'Not in project' });
    expect(await teamRole(ccId, joiner.id)).toBeNull();
    await expectMail(joiner.email, SUBJ.joinRejected(ccNumber));
  });

  test('second request is approved by an admin; the user joins the LiteLLM team', async () => {
    const req = await json(joiner.api.post('/api/v1/me/join-requests', { data: { costCenterId: ccId } }), 201);
    expect((await json(admin.api.post(`/api/v1/cost-centers/${ccId}/join-requests/${req.id}/approve`))).status).toBe('approved');
    expect(await teamRole(ccId, joiner.id)).toBe('user');
    await expectError(joiner.api.post('/api/v1/me/join-requests', { data: { costCenterId: ccId } }), 409, 'COST_CENTER_MEMBER_EXISTS');
  });
});

test.describe('6. cost center budget with real spend (F-KST-4/5/6/9)', () => {
  test('budget is mirrored to the LiteLLM team', async () => {
    const cc = await json(owner.api.patch(`/api/v1/cost-centers/${ccId}`, { data: { maxBudget: TINY, budgetPeriod: 'monthly' } }));
    expect(cc).toMatchObject({ maxBudget: TINY, budgetPeriod: 'monthly', blocked: false });
    const team = await getTeam(ccId);
    expect(team!.maxBudget).toBeCloseTo(TINY, 9);
    expect(team!.budgetDuration).toBe('30d');
  });

  test('one real request exhausts it: cost center, team and all its keys are blocked', async () => {
    test.setTimeout(330_000);
    const answer = await json(member.api.post('/api/v1/key-test', { data: { key: memberKey.secret, model, prompt: 'Say OK' } }));
    expect(answer.answer.length).toBeGreaterThan(0);

    await ingestUntil(admin.api, async () => (await json(owner.api.get(`/api/v1/cost-centers/${ccId}`))).blocked === true);
    expect((await getTeam(ccId))!.blocked).toBe(true);
    for (const k of [memberKey, requesterKey, bulkKey]) expect((await getKey(k.secret)).blocked).toBe(true);
    expect(await keyStatus(member, memberKey.id)).toBe('blocked');
    await expectMail(owner.email, SUBJ.ccBudget100(ccNumber));
    expect(await chatDirect(memberKey.secret, model), 'LiteLLM refuses keys of the exhausted cost center').toBeGreaterThanOrEqual(400);
  });

  test('raising the budget lifts the block', async () => {
    test.setTimeout(330_000);
    await json(owner.api.patch(`/api/v1/cost-centers/${ccId}`, { data: { maxBudget: 100, budgetPeriod: 'monthly' } }));
    await ingestUntil(admin.api, async () => (await json(owner.api.get(`/api/v1/cost-centers/${ccId}`))).blocked === false);
    const team = await getTeam(ccId);
    expect(team!.blocked).toBe(false);
    expect(team!.maxBudget).toBe(100);
    for (const k of [memberKey, requesterKey, bulkKey]) expect((await getKey(k.secret)).blocked).toBe(false);
    // LiteLLM keeps the blocked team in its auth cache for a while; wait until requests go through again
    await expect.poll(() => chatDirect(memberKey.secret, model), { timeout: 120_000, intervals: [5_000] }).toBe(200);
  });
});

test.describe('7. user budget with real spend (F-BUD-1/1a/6)', () => {
  test('budget is mirrored to the LiteLLM user; key budgets cannot exceed it', async () => {
    const b = await json(admin.api.put(`/api/v1/admin/users/${requester.id}/budget`, { data: { amount: TINY, period: 'monthly' } }));
    expect(b).toMatchObject({ amount: TINY, period: 'monthly' });
    expect((await json(requester.api.get('/api/v1/me/budget'))).amount).toBe(TINY);
    expect((await getUser(requester.id))!.maxBudget).toBeCloseTo(TINY, 9);
    await expectError(requester.api.post('/api/v1/api-keys', { data: { name: `test ${RUN}`, models: [model], costCenterId: ccId, budget: 5 } }), 409, 'KEY_BUDGET_EXCEEDS_USER_BUDGET');
  });

  test('one real request exhausts it: all keys of the user are blocked', async () => {
    test.setTimeout(330_000);
    await json(requester.api.post('/api/v1/key-test', { data: { key: requesterKey.secret, model, prompt: 'Say OK' } }));
    await ingestUntil(admin.api, async () => (await json(requester.api.get('/api/v1/me/spend'))).blocked === true);
    expect((await getKey(requesterKey.secret)).blocked).toBe(true);
    expect(await keyStatus(requester, requesterKey.id)).toBe('blocked');
    await expectMail(requester.email, SUBJ.userBudget100);
    // keys of other users on the same cost center keep working
    expect((await getKey(memberKey.secret)).blocked).toBe(false);
  });

  test('raising the budget unblocks the keys', async () => {
    test.setTimeout(330_000);
    await json(admin.api.put(`/api/v1/admin/users/${requester.id}/budget`, { data: { amount: 100, period: 'monthly' } }));
    await ingestUntil(admin.api, async () => (await json(requester.api.get('/api/v1/me/spend'))).blocked === false);
    expect((await getKey(requesterKey.secret)).blocked).toBe(false);
    expect((await getUser(requester.id))!.maxBudget).toBe(100);
  });
});

test.describe('8. deactivate and reactivate a user (F-USR-2/3)', () => {
  test('deactivation locks the login and blocks all keys in LiteLLM', async () => {
    const u = await json(admin.api.post(`/api/v1/admin/users/${bulk.id}/deactivate`));
    expect(u.status).toBe('deactivated');
    await expectError(bulk.api.get('/api/v1/me'), 403, 'ACCOUNT_DEACTIVATED');
    expect((await getKey(bulkKey.secret)).blocked).toBe(true);
    await expectMail(bulk.email, SUBJ.deactivated);
  });

  test('a deactivated user cannot be added to a cost center', async () => {
    await json(admin.api.post(`/api/v1/admin/users/${outsider.id}/deactivate`));
    await expectError(owner.api.post(`/api/v1/cost-centers/${ccId}/members`, { data: { userId: outsider.id } }), 409, 'USER_DEACTIVATED');
    expect(await teamRole(ccId, outsider.id)).toBeNull();
  });

  test('reactivation restores the login; keys stay blocked', async () => {
    expect((await json(admin.api.post(`/api/v1/admin/users/${bulk.id}/reactivate`))).status).toBe('active');
    bulk = await relogin(bulk);
    expect((await bulk.api.get('/api/v1/me')).status()).toBe(200);
    expect((await getKey(bulkKey.secret)).blocked).toBe(true);
    expect(await keyStatus(bulk, bulkKey.id)).toBe('blocked');
  });
});

test.describe('9. archive the cost center (F-KST-1/9)', () => {
  test('archiving blocks the LiteLLM team and every key of the cost center', async () => {
    expect((await json(admin.api.post(`/api/v1/admin/cost-centers/${ccId}/archive`))).status).toBe('archived');
    expect((await getTeam(ccId))!.blocked).toBe(true);
    for (const k of [memberKey, requesterKey]) expect((await getKey(k.secret)).blocked).toBe(true);
    await expectError(member.api.post('/api/v1/me/join-requests', { data: { costCenterId: ccId } }), 409);
  });
});
