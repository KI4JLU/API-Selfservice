import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUserSchema, NotificationSchema, paginated } from '@api-selfservice/shared';
import { approvedCostCenterFor, createTestApp, expectError, expectShape, syncProvidersWithFree, uniqEmail, type Client, type TestApp } from './harness.js';

describe('user administration', () => {
  let t: TestApp;
  let admin: Client;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true, name: 'Root Admin' });
    await syncProvidersWithFree(admin);
  });
  afterAll(() => t.close());

  it('lists, searches and paginates users; deactivated users are hidden unless requested', async () => {
    const needle = uniqEmail('findme');
    const u = await t.login({ email: needle, name: 'Findable Person' });
    const cc = await approvedCostCenterFor(t, admin, u);
    await u.post('/api-keys', { name: 'k', models: ['gpt-4o'], costCenterId: cc.id });
    await admin.put(`/admin/users/${u.userId}/budget`, { amount: 12, period: 'monthly' });

    const all = expectShape(paginated(AdminUserSchema), (await admin.get('/admin/users')).body);
    expect(all.total).toBeGreaterThanOrEqual(2);
    const row = all.items.find((x) => x.id === u.userId)!;
    expect(row).toMatchObject({
      email: needle,
      name: 'Findable Person',
      role: 'user',
      roleFromIdp: false,
      locale: 'de',
      costCenter: { id: cc.id, number: cc.number },
      managedCostCenters: [],
      budget: { amount: 12, period: 'monthly' },
      spendCurrentPeriod: 0,
      keyCount: 1,
      status: 'active',
      deletedAt: null,
      deletedReason: null,
    });
    expect(row.lastLoginAt).not.toBeNull();

    expect((await admin.get('/admin/users?q=findme')).body.items.map((x: { id: string }) => x.id)).toEqual([u.userId]);
    expect((await admin.get('/admin/users?q=Findable')).body.items.map((x: { id: string }) => x.id)).toEqual([u.userId]);
    expect((await admin.get('/admin/users?q=zzz-nobody')).body.total).toBe(0);
    expect((await admin.get(`/admin/users?costCenterId=${cc.id}`)).body.items.map((x: { id: string }) => x.id)).toEqual([u.userId]);
    const p = (await admin.get('/admin/users?pageSize=1&page=1')).body;
    expect(p.items).toHaveLength(1);
    expect(p.pageSize).toBe(1);

    const one = expectShape(AdminUserSchema, (await admin.get(`/admin/users/${u.userId}`)).body);
    expect(one.id).toBe(u.userId);
    expectError(await admin.get('/admin/users/nope'), 404, 'NOT_FOUND');

    await admin.post(`/admin/users/${u.userId}/deactivate`);
    expect((await admin.get('/admin/users?q=findme')).body.total).toBe(0);
    expect((await admin.get('/admin/users?q=findme&includeDeactivated=true')).body.items[0]).toMatchObject({ id: u.userId, status: 'deactivated', deletedReason: 'admin' });
  });

  it('set role user -> admin and back (mail + audit)', async () => {
    const u = await t.login();
    const r = await admin.patch(`/admin/users/${u.userId}/role`, { role: 'admin' });
    expect(r.status).toBe(200);
    expect(expectShape(AdminUserSchema, r.body)).toMatchObject({ role: 'admin', roleFromIdp: false });
    expect((await u.get('/me')).body).toMatchObject({ role: 'admin', effectiveRole: 'admin' });
    expect((await u.get('/admin/users')).status).toBe(200);
    expect(await t.notificationsOf('role_changed', u.email)).toHaveLength(1);
    // idempotent
    await admin.patch(`/admin/users/${u.userId}/role`, { role: 'admin' });
    expect(await t.notificationsOf('role_changed', u.email)).toHaveLength(1);

    const back = await admin.patch(`/admin/users/${u.userId}/role`, { role: 'user' });
    expect(back.body.role).toBe('user');
    expectError(await u.get('/admin/users'), 403, 'FORBIDDEN');
    expect(await t.notificationsOf('role_changed', u.email)).toHaveLength(2);
    expectError(await admin.patch(`/admin/users/${u.userId}/role`, { role: 'superuser' }), 400, 'VALIDATION_ERROR');
    expectError(await admin.patch('/admin/users/nope/role', { role: 'admin' }), 404, 'NOT_FOUND');
    const { auditLog, eq, and } = await import('@api-selfservice/db');
    const entries = await t.db.query.auditLog.findMany({ where: and(eq(auditLog.action, 'user.set_role'), eq(auditLog.entityId, u.userId)) });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.actorId === admin.userId)).toBe(true);
  });

  it('demoting an IdP-managed admin -> ROLE_MANAGED_BY_IDP', async () => {
    const idp = await t.login({ admin: true });
    expectError(await admin.patch(`/admin/users/${idp.userId}/role`, { role: 'user' }), 409, 'ROLE_MANAGED_BY_IDP');
    expect((await admin.get(`/admin/users/${idp.userId}`)).body).toMatchObject({ role: 'admin', roleFromIdp: true });
    // re-affirming admin is fine
    expect((await admin.patch(`/admin/users/${idp.userId}/role`, { role: 'admin' })).status).toBe(200);
  });

  it('self deactivation -> SELF_DEACTIVATION', async () => {
    expectError(await admin.post(`/admin/users/${admin.userId}/deactivate`), 409, 'SELF_DEACTIVATION');
    expect((await admin.get('/me')).status).toBe(200);
  });

  it('deactivate blocks keys, LiteLLM user and login; mails user and admins; reactivate keeps keys blocked (F-USR-3)', async () => {
    const u = await t.login({ name: 'Victim' });
    const cc = await approvedCostCenterFor(t, admin, u);
    const k = (await u.post('/api-keys', { name: 'k', models: ['gpt-4o'], costCenterId: cc.id })).body;
    const litellmKeyId = await t.litellmKeyIdOf(k.id);
    const admin2 = await t.login({ admin: true });
    const adminMailsBefore = (await t.notificationsOf('user_deactivated', admin.email)).length;

    const r = await admin.post(`/admin/users/${u.userId}/deactivate`);
    expect(r.status).toBe(200);
    const view = expectShape(AdminUserSchema, r.body);
    expect(view).toMatchObject({ status: 'deactivated', deletedReason: 'admin', deletedAt: t.clock.now.toISOString(), keyCount: 1 });
    expectError(await u.get('/me'), 403, 'ACCOUNT_DEACTIVATED');
    const row = await t.keyRow(k.id);
    expect(row.status).toBe('blocked');
    expect(row.blockedReason).toBe('user_deactivated');
    expect(t.mock.keys.get(litellmKeyId)!.blocked).toBe(true);
    expect(t.mock.users.get(u.userId)!.blocked).toBe(true);
    expect(await t.notificationsOf('user_deactivated', u.email)).toHaveLength(1);
    expect(await t.notificationsOf('user_deactivated', admin.email)).toHaveLength(adminMailsBefore + 1);
    expect(await t.notificationsOf('user_deactivated', admin2.email)).toHaveLength(1);
    // idempotent
    expect((await admin.post(`/admin/users/${u.userId}/deactivate`)).status).toBe(200);
    expect(await t.notificationsOf('user_deactivated', u.email)).toHaveLength(1);
    // a new login of the deactivated user is still refused
    const again = await t.login({ email: u.email });
    expectError(await again.get('/me'), 403, 'ACCOUNT_DEACTIVATED');

    const re = await admin.post(`/admin/users/${u.userId}/reactivate`);
    expect(re.status).toBe(200);
    expect(expectShape(AdminUserSchema, re.body)).toMatchObject({ status: 'active', deletedAt: null, deletedReason: null });
    expect((await u.get('/me')).status).toBe(200);
    expect(t.mock.users.get(u.userId)!.blocked).toBe(false);
    // keys stay blocked and must be recreated
    expect((await u.get('/api-keys')).body.items[0].status).toBe('blocked');
    expect(t.mock.keys.get(litellmKeyId)!.blocked).toBe(true);
    expectError(await u.post(`/api-keys/${k.id}/extend`), 409, 'KEY_NOT_ACTIVE');
    expect((await u.post('/api-keys', { name: 'k2', models: ['gpt-4o'], costCenterId: cc.id })).status).toBe(201);
    expect((await admin.post(`/admin/users/${u.userId}/reactivate`)).status).toBe(200);
    expectError(await admin.post('/admin/users/nope/reactivate'), 404, 'NOT_FOUND');
    expectError(await admin.post('/admin/users/nope/deactivate'), 404, 'NOT_FOUND');
  });

  it('GET /admin/notifications lists sent mails with filters', async () => {
    const r = await admin.get('/admin/notifications?type=user_deactivated&pageSize=5');
    expect(r.status).toBe(200);
    const page = expectShape(paginated(NotificationSchema), r.body);
    expect(page.total).toBeGreaterThanOrEqual(3);
    expect(page.items.every((n) => n.type === 'user_deactivated' && n.status === 'sent')).toBe(true);
    expect((await admin.get('/admin/notifications?status=failed')).body.total).toBe(0);
    expectError(await admin.get('/admin/notifications?type=nope'), 400, 'VALIDATION_ERROR');
  });

  it('cost-center-admin assignments are replaced as a whole', async () => {
    const u = await t.login();
    const a = await approvedCostCenterFor(t, admin, u);
    const b = await approvedCostCenterFor(t, admin, await t.login());
    expect((await admin.put(`/admin/users/${u.userId}/cost-center-admin`, { costCenterIds: [a.id, b.id] })).body.managedCostCenters.map((c: { id: string }) => c.id).sort()).toEqual([a.id, b.id].sort());
    // mirrored as LiteLLM team admin (E-8)
    expect(t.mock.teams.get(a.id)?.members.get(u.userId)).toBe('admin');
    expect(t.mock.teams.get(b.id)?.members.get(u.userId)).toBe('admin');
    expect((await admin.put(`/admin/users/${u.userId}/cost-center-admin`, { costCenterIds: [b.id] })).body.managedCostCenters.map((c: { id: string }) => c.id)).toEqual([b.id]);
    // a is still the user's own cost center -> plain member; b stays admin
    expect(t.mock.teams.get(a.id)?.members.get(u.userId)).toBe('user');
    expect(t.mock.teams.get(b.id)?.members.get(u.userId)).toBe('admin');
    expect((await u.get('/me')).body.managedCostCenters.map((c: { id: string }) => c.id)).toEqual([b.id]);
    expectError(await admin.put('/admin/users/nope/cost-center-admin', { costCenterIds: [] }), 404, 'NOT_FOUND');
  });

  // Last: temporarily leaves only one (non-IdP) admin.
  it('demoting the last admin -> LAST_ADMIN', async () => {
    // Deactivate every other admin except `admin` and one freshly promoted user.
    const promoted = await t.login({ name: 'Promoted' });
    await admin.patch(`/admin/users/${promoted.userId}/role`, { role: 'admin' });
    const admins = (await admin.get('/admin/users?pageSize=200')).body.items.filter((x: { role: string; id: string }) => x.role === 'admin' && x.id !== admin.userId && x.id !== promoted.userId);
    for (const a of admins) expect((await admin.post(`/admin/users/${a.id}/deactivate`)).status).toBe(200);
    // `admin` gives up the IdP role via a fresh dev-login without admin
    const demoted = await t.login({ email: admin.email, admin: false });
    expect((await demoted.get('/me')).body.role).toBe('user');
    // `promoted` is now the last admin and cannot demote themselves
    expectError(await promoted.patch(`/admin/users/${promoted.userId}/role`, { role: 'user' }), 409, 'LAST_ADMIN');
    expect((await promoted.get('/me')).body.role).toBe('admin');
    // once a second admin exists, demotion works again
    expect((await promoted.patch(`/admin/users/${admin.userId}/role`, { role: 'admin' })).status).toBe(200);
    expect((await promoted.patch(`/admin/users/${promoted.userId}/role`, { role: 'user' })).status).toBe(200);
  });
});
