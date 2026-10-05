import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { costCenterMembers, costCenters, eq } from '@api-selfservice/db';
import { BulkAddCostCenterMembersResultSchema, CostCenterMemberSchema, MeSchema, MemberCandidateSchema, ResolvedMemberEmailsSchema } from '@api-selfservice/shared';
import { syncMigratedMembershipsOnce } from '../services/cost-center-members.js';
import { addMember, createTestApp, expectError, expectShape, litellmOwner, randomCostCenter, syncProvidersWithFree, uniqEmail, type Client, type TestApp } from './harness.js';

describe('cost center members (F-KST-10 to F-KST-13)', () => {
  let t: TestApp;
  let admin: Client;
  let ccAdmin: Client;
  let cc: { id: string; number: string };
  let defaultId: string;

  /** New approved cost center; the owner (default: a LiteLLM-only user) is its first cost center admin. */
  const newCostCenter = async (ownerUserId?: string) => {
    const number = randomCostCenter();
    const r = await admin.post('/admin/cost-centers', { number, name: `CC ${number}`, ownerUserId: ownerUserId ?? (await litellmOwner(t)).userId });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return { id: r.body.id as string, number };
  };
  const members = async (c: Client, id = cc.id) => expectShape(z.array(CostCenterMemberSchema), (await c.get(`/cost-centers/${id}/members`)).body);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true, name: 'Root Admin' });
    await syncProvidersWithFree(admin);
    defaultId = (await admin.get('/me')).body.costCenter.id;
    ccAdmin = await t.login({ name: 'Cc Admin' });
    cc = await newCostCenter(ccAdmin.userId);
  });
  afterAll(() => t.close());

  it('the owner an admin picks becomes the cost center admin (F-KST-14)', async () => {
    const me = expectShape(MeSchema, (await ccAdmin.get('/me')).body);
    expect(me.effectiveRole).toBe('cost_center_admin');
    expect(me.managedCostCenters.map((c) => c.id)).toEqual([cc.id]);
    expect(me.memberCostCenters.map((c) => [c.id, c.role])).toEqual([
      [defaultId, 'user'],
      [cc.id, 'admin'],
    ]);
    expect(t.mock.teams.get(cc.id)?.members.get(ccAdmin.userId)).toBe('admin');
    expect(await members(ccAdmin)).toEqual([expect.objectContaining({ userId: ccAdmin.userId, role: 'admin', status: 'active', name: 'Cc Admin', addedBy: admin.userId })]);
  });

  it('finds known LiteLLM users by e-mail, including people who never signed in', async () => {
    await t.mock.createUser({ userId: 'll-cand-1', email: 'cand-one@test.local', alias: 'Candidate One' });
    const u = await t.login({ email: 'cand-two@test.local' });
    const r = expectShape(z.array(MemberCandidateSchema), (await ccAdmin.get(`/cost-centers/${cc.id}/member-candidates?q=cand-`)).body);
    expect(r.map((c) => c.userId).sort()).toEqual(['ll-cand-1', u.userId].sort());
    expect(r.find((c) => c.userId === 'll-cand-1')).toEqual({ userId: 'll-cand-1', email: 'cand-one@test.local', alias: 'Candidate One', hasAccount: false, isMember: false });
    expect(r.find((c) => c.userId === u.userId)).toMatchObject({ hasAccount: true, isMember: false });
    await addMember(ccAdmin, cc.id, u);
    expect((await ccAdmin.get(`/cost-centers/${cc.id}/member-candidates?q=cand-two`)).body).toEqual([expect.objectContaining({ userId: u.userId, isMember: true })]);
    // short queries would list the whole user directory
    expectError(await ccAdmin.get(`/cost-centers/${cc.id}/member-candidates?q=ca`), 400, 'VALIDATION_ERROR');
  });

  it('adds a LiteLLM user who never signed in; the membership applies on their first login', async () => {
    const email = uniqEmail('late');
    await t.mock.createUser({ userId: 'll-late-1', email, alias: 'Late Joiner' });
    const r = await ccAdmin.post(`/cost-centers/${cc.id}/members`, { userId: 'll-late-1' });
    expect(r.status).toBe(201);
    expect(expectShape(CostCenterMemberSchema, r.body)).toMatchObject({ userId: 'll-late-1', email, name: null, role: 'user', status: 'never_signed_in', addedBy: ccAdmin.userId });
    expect(t.mock.teams.get(cc.id)?.members.get('ll-late-1')).toBe('user');
    expect(await t.notificationsOf('cost_center_member_added', email)).toHaveLength(1);
    const events = (await admin.get(`/admin/events?action=cost_center.member_add&entityId=${cc.id}`)).body.items as { payload: { userId: string } }[];
    expect(events.some((e) => e.payload.userId === 'll-late-1')).toBe(true);

    // First login adopts the LiteLLM id (E-7), so the cost center is there right away.
    const late = await t.login({ email, name: 'Late Joiner' });
    expect(late.userId).toBe('ll-late-1');
    const me = expectShape(MeSchema, (await late.get('/me')).body);
    expect(me.costCenter.id).toBe(cc.id);
    expect(me.memberCostCenters.map((c) => c.id)).toEqual([defaultId, cc.id]);
    expect((await members(ccAdmin)).find((m) => m.userId === 'll-late-1')).toMatchObject({ status: 'active', name: 'Late Joiner' });
  });

  it('members can create keys on the cost center, others cannot (F-KST-12)', async () => {
    const m = await t.login();
    const outsider = await t.login();
    expectError(await m.post('/api-keys', { name: 'k', models: ['gpt-4o'], costCenterId: cc.id }), 409, 'COST_CENTER_NOT_MEMBER');
    await addMember(ccAdmin, cc.id, m);
    // the first own cost center replaces the default in the profile
    expect((await m.get('/me')).body.costCenter.id).toBe(cc.id);
    expect((await m.post('/api-keys', { name: 'k', models: ['gpt-4o'], costCenterId: cc.id })).status).toBe(201);
    expectError(await outsider.post('/api-keys', { name: 'k', models: ['gpt-4o'], costCenterId: cc.id }), 409, 'COST_CENTER_NOT_MEMBER');
    expectError(await outsider.patch('/me', { costCenterNumber: cc.number }), 409, 'COST_CENTER_NOT_MEMBER');
    expect(await t.notificationsOf('cost_center_member_added', m.email)).toHaveLength(1);
  });

  it('rejects duplicates, unknown LiteLLM users, deactivated users, the default and non-approved cost centers', async () => {
    const m = await t.login();
    await addMember(ccAdmin, cc.id, m);
    expectError(await ccAdmin.post(`/cost-centers/${cc.id}/members`, { userId: m.userId }), 409, 'COST_CENTER_MEMBER_EXISTS');
    expectError(await ccAdmin.post(`/cost-centers/${cc.id}/members`, { userId: 'nobody-in-litellm' }), 404, 'NOT_FOUND');
    expectError(await ccAdmin.post(`/cost-centers/${cc.id}/members`, { userId: m.userId, role: 'owner' }), 400, 'VALIDATION_ERROR');
    const gone = await t.login();
    expect((await admin.post(`/admin/users/${gone.userId}/deactivate`)).status).toBe(200);
    expectError(await ccAdmin.post(`/cost-centers/${cc.id}/members`, { userId: gone.userId }), 409, 'USER_DEACTIVATED');
    // deactivating an existing member shows in the list
    expect((await admin.post(`/admin/users/${m.userId}/deactivate`)).status).toBe(200);
    expect((await members(ccAdmin)).find((x) => x.userId === m.userId)?.status).toBe('deactivated');
    // every user is a member of the default cost center
    expectError(await admin.post(`/cost-centers/${defaultId}/members`, { userId: ccAdmin.userId }), 409, 'COST_CENTER_DEFAULT_IMMUTABLE');
    expectError(await admin.get(`/cost-centers/${defaultId}/members`), 409, 'COST_CENTER_DEFAULT_IMMUTABLE');
    // pending cost centers have no team yet
    const requester = await t.login();
    const number = randomCostCenter();
    expect((await requester.post('/cost-centers', { number, name: 'n', ownerEmail: requester.email })).status).toBe(201);
    const pending = (await admin.get('/cost-centers?status=pending')).body.items.find((c: { number: string }) => c.number === number);
    expectError(await admin.post(`/cost-centers/${pending.id}/members`, { userId: ccAdmin.userId }), 409, 'COST_CENTER_NOT_APPROVED');
    expectError(await admin.get('/cost-centers/nope/members'), 404, 'NOT_FOUND');
  });

  it('bulk add: resolves pasted addresses, reports unknown and invalid ones, adds the found users', async () => {
    const known = uniqEmail('bulk-known');
    await t.mock.createUser({ userId: 'll-bulk-1', email: known, alias: 'Bulk One' });
    const signedIn = await t.login();
    const existing = await t.login();
    await addMember(ccAdmin, cc.id, existing);
    const unknown = uniqEmail('bulk-unknown');

    const r = await ccAdmin.post(`/cost-centers/${cc.id}/member-candidates/resolve`, {
      emails: [known.toUpperCase(), signedIn.email, existing.email, unknown, 'not-an-address', known],
    });
    expect(r.status).toBe(200);
    const res = expectShape(ResolvedMemberEmailsSchema, r.body);
    expect(res.found.map((c) => [c.userId, c.isMember, c.hasAccount])).toEqual([
      ['ll-bulk-1', false, false],
      [signedIn.userId, false, true],
      [existing.userId, true, true],
    ]);
    expect(res.notFound).toEqual([unknown]);
    expect(res.invalid).toEqual(['not-an-address']);

    const b = await ccAdmin.post(`/cost-centers/${cc.id}/members/bulk`, { userIds: ['ll-bulk-1', signedIn.userId, existing.userId, 'nobody-in-litellm'] });
    expect(b.status).toBe(200);
    const out = expectShape(BulkAddCostCenterMembersResultSchema, b.body);
    expect(out.added.map((m) => m.userId)).toEqual(['ll-bulk-1', signedIn.userId]);
    expect(out.failed).toEqual([
      { userId: existing.userId, code: 'COST_CENTER_MEMBER_EXISTS' },
      { userId: 'nobody-in-litellm', code: 'NOT_FOUND' },
    ]);
    expect(t.mock.teams.get(cc.id)?.members.get('ll-bulk-1')).toBe('user');
    expect(await t.notificationsOf('cost_center_member_added', known)).toHaveLength(1);

    // limits, roles and scope as for single adds
    expectError(await ccAdmin.post(`/cost-centers/${cc.id}/member-candidates/resolve`, { emails: [] }), 400, 'VALIDATION_ERROR');
    expectError(await ccAdmin.post(`/cost-centers/${cc.id}/member-candidates/resolve`, { emails: Array.from({ length: 201 }, (_, i) => `a${i}@x.de`) }), 400, 'VALIDATION_ERROR');
    expectError(await admin.post(`/cost-centers/${defaultId}/members/bulk`, { userIds: [signedIn.userId] }), 409, 'COST_CENTER_DEFAULT_IMMUTABLE');
    const plainAdmin = await t.login();
    await addMember(ccAdmin, cc.id, plainAdmin, 'admin');
    expectError(await plainAdmin.post(`/cost-centers/${cc.id}/members/bulk`, { userIds: [unknown], role: 'admin' }), 403, 'COST_CENTER_OWNER_ONLY');
  });

  it('plain members and admins of other cost centers get FORBIDDEN', async () => {
    const plain = await t.login();
    await addMember(admin, cc.id, plain);
    const other = await newCostCenter();
    const otherAdmin = await t.login();
    await addMember(admin, other.id, otherAdmin, 'admin');
    for (const c of [plain, otherAdmin]) {
      expectError(await c.get(`/cost-centers/${cc.id}/members`), 403, 'FORBIDDEN');
      expectError(await c.get(`/cost-centers/${cc.id}/member-candidates?q=test`), 403, 'FORBIDDEN');
      expectError(await c.post(`/cost-centers/${cc.id}/members`, { userId: c.userId }), 403, 'FORBIDDEN');
      expectError(await c.post(`/cost-centers/${cc.id}/member-candidates/resolve`, { emails: [c.email] }), 403, 'FORBIDDEN');
      expectError(await c.post(`/cost-centers/${cc.id}/members/bulk`, { userIds: [c.userId] }), 403, 'FORBIDDEN');
      expectError(await c.patch(`/cost-centers/${cc.id}/members/${ccAdmin.userId}`, { role: 'user' }), 403, 'FORBIDDEN');
      expectError(await c.delete(`/cost-centers/${cc.id}/members/${ccAdmin.userId}`), 403, 'FORBIDDEN');
    }
    expect((await otherAdmin.get(`/cost-centers/${other.id}/members`)).status).toBe(200);
  });

  it('several admins per cost center; the owner stays admin until another owner is set (F-KST-14)', async () => {
    const first = await t.login();
    const c2 = await newCostCenter(first.userId);
    const second = await t.login();
    await addMember(first, c2.id, second);
    const r = await first.patch(`/cost-centers/${c2.id}/members/${second.userId}`, { role: 'admin' });
    expect(r.status).toBe(200);
    expect(expectShape(CostCenterMemberSchema, r.body).role).toBe('admin');
    expect(t.mock.teams.get(c2.id)?.members.get(second.userId)).toBe('admin');
    expect((await second.get('/me')).body.effectiveRole).toBe('cost_center_admin');
    expect(await t.notificationsOf('role_changed', second.email)).toHaveLength(1);
    expect((await members(admin, c2.id)).map((m) => m.role)).toEqual(['admin', 'admin']);

    // the owner can neither step down nor leave, not even through a global admin or the user screen
    expectError(await first.patch(`/cost-centers/${c2.id}/members/${first.userId}`, { role: 'user' }), 409, 'COST_CENTER_OWNER_MUST_BE_ADMIN');
    expectError(await first.delete(`/cost-centers/${c2.id}/members/${first.userId}`), 409, 'COST_CENTER_OWNER_MUST_BE_ADMIN');
    expectError(await admin.delete(`/cost-centers/${c2.id}/members/${first.userId}`), 409, 'COST_CENTER_OWNER_MUST_BE_ADMIN');
    expectError(await admin.put(`/admin/users/${first.userId}/cost-center-admin`, { costCenterIds: [] }), 409, 'COST_CENTER_OWNER_MUST_BE_ADMIN');
    // after a new owner is set, the previous one is a normal admin whom only the new owner can demote
    expect((await admin.patch(`/cost-centers/${c2.id}`, { ownerUserId: second.userId })).body.ownerUserId).toBe(second.userId);
    expectError(await first.patch(`/cost-centers/${c2.id}/members/${first.userId}`, { role: 'user' }), 403, 'COST_CENTER_OWNER_ONLY');
    expect((await second.patch(`/cost-centers/${c2.id}/members/${first.userId}`, { role: 'user' })).body.role).toBe('user');
    expect(t.mock.teams.get(c2.id)?.members.get(first.userId)).toBe('user');
    expect((await first.get('/me')).body.effectiveRole).toBe('user');
    expectError(await admin.patch(`/cost-centers/${c2.id}/members/nope`, { role: 'admin' }), 404, 'NOT_FOUND');
  });

  it('only the owner appoints, demotes or removes admins; other admins manage plain members (F-KST-13)', async () => {
    const owner = await t.login();
    const c4 = await newCostCenter(owner.userId);
    const deputy = await t.login();
    const other = await t.login();
    const plain = await t.login();
    await addMember(owner, c4.id, deputy, 'admin');
    await addMember(owner, c4.id, other, 'admin');
    expect((await deputy.get('/me')).body.effectiveRole).toBe('cost_center_admin');

    // plain members: the deputy adds and removes them
    await addMember(deputy, c4.id, plain);
    expect((await deputy.delete(`/cost-centers/${c4.id}/members/${plain.userId}`)).status).toBe(200);
    // admins: owner only
    expectError(await deputy.post(`/cost-centers/${c4.id}/members`, { userId: plain.userId, role: 'admin' }), 403, 'COST_CENTER_OWNER_ONLY');
    await addMember(deputy, c4.id, plain);
    expectError(await deputy.patch(`/cost-centers/${c4.id}/members/${plain.userId}`, { role: 'admin' }), 403, 'COST_CENTER_OWNER_ONLY');
    expectError(await deputy.patch(`/cost-centers/${c4.id}/members/${other.userId}`, { role: 'user' }), 403, 'COST_CENTER_OWNER_ONLY');
    expectError(await deputy.delete(`/cost-centers/${c4.id}/members/${other.userId}`), 403, 'COST_CENTER_OWNER_ONLY');
    expectError(await deputy.delete(`/cost-centers/${c4.id}/members/${deputy.userId}`), 403, 'COST_CENTER_OWNER_ONLY');
    expect(
      (await members(admin, c4.id))
        .filter((m) => m.role === 'admin')
        .map((m) => m.userId)
        .sort(),
    ).toEqual([owner.userId, deputy.userId, other.userId].sort());

    expect((await owner.patch(`/cost-centers/${c4.id}/members/${plain.userId}`, { role: 'admin' })).body.role).toBe('admin');
    expect((await owner.delete(`/cost-centers/${c4.id}/members/${other.userId}`)).status).toBe(200);
    expect(t.mock.teams.get(c4.id)?.members.has(other.userId)).toBe(false);
  });

  it('without a linked owner (legacy data) only global admins manage admins', async () => {
    const legacyAdmin = await t.login();
    const c3 = await newCostCenter(legacyAdmin.userId);
    await t.db.update(costCenters).set({ ownerUserId: null }).where(eq(costCenters.id, c3.id));
    expect((await admin.get(`/cost-centers/${c3.id}`)).body.ownerUserId).toBeNull();
    expectError(await legacyAdmin.patch(`/cost-centers/${c3.id}/members/${legacyAdmin.userId}`, { role: 'user' }), 403, 'COST_CENTER_OWNER_ONLY');
    expectError(await legacyAdmin.delete(`/cost-centers/${c3.id}/members/${legacyAdmin.userId}`), 403, 'COST_CENTER_OWNER_ONLY');
    expect((await admin.patch(`/cost-centers/${c3.id}/members/${legacyAdmin.userId}`, { role: 'user' })).body.role).toBe('user');
  });

  it('requests name the owner by e-mail; on approval the owner becomes admin, the requester a member', async () => {
    const requester = await t.login();
    const ownerEmail = uniqEmail('req-owner');
    const owner = await litellmOwner(t, ownerEmail, 'Request Owner');
    const number = randomCostCenter();
    expectError(await requester.post('/cost-centers', { number, name: 'Lab', ownerEmail: 'unknown@x.de' }), 409, 'OWNER_NOT_LITELLM_USER');
    const req = await requester.post('/cost-centers', { number, name: 'Lab', ownerEmail: ownerEmail.toUpperCase() });
    expect(req.status).toBe(201);
    expect(req.body.costCenter).toMatchObject({ ownerName: 'Request Owner', ownerEmail });
    expect((await admin.post(`/cost-center-requests/${req.body.id}/approve`)).status).toBe(200);
    const roles = Object.fromEntries((await members(admin, req.body.costCenter.id)).map((m) => [m.userId, m.role]));
    expect(roles).toEqual({ [owner.userId]: 'admin', [requester.userId]: 'user' });
    expect(await t.notificationsOf('cost_center_member_added', ownerEmail)).toHaveLength(1);
  });

  it('mirrors memberships written by migrations into LiteLLM once', async () => {
    const u = await t.login();
    await t.db.insert(costCenterMembers).values({ costCenterId: cc.id, userId: u.userId, role: 'user' });
    expect(t.mock.teams.get(cc.id)?.members.has(u.userId)).toBe(false);
    expect((await syncMigratedMembershipsOnce(t.deps, 'test-sync')).synced).toBeGreaterThan(0);
    expect(t.mock.teams.get(cc.id)?.members.get(u.userId)).toBe('user');
    expect(await syncMigratedMembershipsOnce(t.deps, 'test-sync')).toEqual({ synced: 0 });
  });

  it('removing a member blocks their keys on the cost center; adding them again unblocks', async () => {
    const m = await t.login();
    await addMember(ccAdmin, cc.id, m);
    const k = (await m.post('/api-keys', { name: 'paid', models: ['gpt-4o'], costCenterId: cc.id })).body;
    const free = (await m.post('/api-keys', { name: 'free', models: ['gemma-local'], costCenterId: defaultId })).body;

    expect((await ccAdmin.delete(`/cost-centers/${cc.id}/members/${m.userId}`)).status).toBe(200);
    expect(await t.keyRow(k.id)).toMatchObject({ status: 'blocked', blockedReason: 'cost_center_member_removed' });
    expect(t.mock.keys.get(await t.litellmKeyIdOf(k.id))?.blocked).toBe(true);
    expect((await t.keyRow(free.id)).status).toBe('active');
    expect(t.mock.teams.get(cc.id)?.members.has(m.userId)).toBe(false);
    const me = expectShape(MeSchema, (await m.get('/me')).body);
    expect(me.costCenter.id).toBe(defaultId);
    expect(me.memberCostCenters.map((c) => c.id)).toEqual([defaultId]);
    expect(await t.notificationsOf('cost_center_member_removed', m.email)).toHaveLength(1);
    expectError(await ccAdmin.delete(`/cost-centers/${cc.id}/members/${m.userId}`), 404, 'NOT_FOUND');

    await addMember(ccAdmin, cc.id, m);
    expect(await t.keyRow(k.id)).toMatchObject({ status: 'active', blockedReason: null });
    expect(t.mock.keys.get(await t.litellmKeyIdOf(k.id))?.blocked).toBe(false);
  });
});
