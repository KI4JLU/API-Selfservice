import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MeSchema } from '@api-selfservice/shared';
import { createTestApp, expectError, expectShape, syncProvidersWithFree, type Client, type TestApp } from './harness.js';

describe('admin impersonation (IMPERSONATION_ENABLED)', () => {
  let t: TestApp;
  let admin: Client;
  let user: Client;

  beforeAll(async () => {
    t = await createTestApp({ IMPERSONATION_ENABLED: 'true' });
    admin = await t.login({ admin: true, name: 'Root Admin' });
    user = await t.login({ name: 'Plain User' });
  });
  afterAll(() => t.close());

  it('admin acts as the user on the same session and can stop again (audited)', async () => {
    const before = expectShape(MeSchema, (await admin.get('/me')).body);
    expect(before).toMatchObject({ id: admin.userId, impersonatedBy: null, impersonationEnabled: true });

    expect((await admin.post(`/admin/users/${user.userId}/impersonate`)).status).toBe(200);

    const me = expectShape(MeSchema, (await admin.get('/me')).body);
    expect(me).toMatchObject({ id: user.userId, name: 'Plain User', role: 'user', effectiveRole: 'user', impersonatedBy: { id: admin.userId, name: 'Root Admin' } });
    // No admin rights while impersonating a plain user.
    expectError(await admin.get('/admin/users'), 403, 'FORBIDDEN');
    // Data endpoints answer for the impersonated user.
    expect((await admin.get('/api-keys')).status).toBe(200);
    // The user's own session is untouched.
    expect((await user.get('/me')).body).toMatchObject({ id: user.userId, impersonatedBy: null });

    expect((await admin.delete('/me/impersonation')).status).toBe(200);
    expect((await admin.get('/me')).body).toMatchObject({ id: admin.userId, impersonatedBy: null });
    expect((await admin.get('/admin/users')).status).toBe(200);

    const { auditLog, eq, and } = await import('@api-selfservice/db');
    const entries = await t.db.query.auditLog.findMany({ where: and(eq(auditLog.actorId, admin.userId), eq(auditLog.entityId, user.userId)) });
    expect(entries.map((e) => e.action).sort()).toEqual(['user.impersonate', 'user.impersonate_stop']);
  });

  it('actions taken while impersonating name the admin in the event log', async () => {
    await syncProvidersWithFree(admin);
    const costCenterId = (await user.get('/me')).body.costCenter.id;
    expect((await admin.post(`/admin/users/${user.userId}/impersonate`)).status).toBe(200);
    const asUser = await admin.post('/api-keys', { name: 'as-user', models: ['gemma-local'], costCenterId });
    expect(asUser.status).toBe(201);
    expect((await admin.delete('/me/impersonation')).status).toBe(200);
    const own = await user.post('/api-keys', { name: 'own', models: ['gemma-local'], costCenterId });
    expect(own.status).toBe(201);

    const { auditLog, eq, and } = await import('@api-selfservice/db');
    const entryOf = async (id: string) => (await t.db.query.auditLog.findFirst({ where: and(eq(auditLog.action, 'key.create'), eq(auditLog.entityId, id)) }))!;
    const e = await entryOf(asUser.body.id);
    expect(e.actorId).toBe(user.userId);
    expect(e.payload).toMatchObject({ name: 'as-user', impersonatedBy: admin.userId });
    // without impersonation nothing is added
    expect((await entryOf(own.body.id)).payload).not.toHaveProperty('impersonatedBy');
  });

  it('refuses self, unknown, deactivated users and non-admins', async () => {
    expectError(await admin.post(`/admin/users/${admin.userId}/impersonate`), 400, 'VALIDATION_ERROR');
    expectError(await admin.post('/admin/users/nope/impersonate'), 404, 'NOT_FOUND');
    const gone = await t.login({ name: 'Gone' });
    await admin.post(`/admin/users/${gone.userId}/deactivate`);
    expectError(await admin.post(`/admin/users/${gone.userId}/impersonate`), 403, 'ACCOUNT_DEACTIVATED');
    expectError(await user.post(`/admin/users/${admin.userId}/impersonate`), 403, 'FORBIDDEN');
    expectError(await user.delete('/me/impersonation'), 403, 'FORBIDDEN');
  });

  it('drops the impersonation instead of locking the admin out when the target gets deactivated', async () => {
    const victim = await t.login({ name: 'Victim' });
    expect((await admin.post(`/admin/users/${victim.userId}/impersonate`)).status).toBe(200);
    expect((await admin.get('/me')).body.id).toBe(victim.userId);
    const { user: userTable, eq } = await import('@api-selfservice/db');
    await t.db.update(userTable).set({ deletedAt: t.deps.now(), deletedReason: 'admin' }).where(eq(userTable.id, victim.userId));
    expect((await admin.get('/me')).body).toMatchObject({ id: admin.userId, impersonatedBy: null });
  });

  it('a session of a user who lost the admin role is never treated as impersonating', async () => {
    const other = await t.login({ name: 'Other' });
    const demoted = await t.login({ admin: true, name: 'Demoted' });
    expect((await demoted.post(`/admin/users/${other.userId}/impersonate`)).status).toBe(200);
    // Dev-login marks admins as IdP-managed, so demote the same way the IdP would (a login without the admin group).
    await t.login({ email: demoted.email, admin: false });
    expect((await demoted.get('/me')).body).toMatchObject({ id: demoted.userId, impersonatedBy: null });
  });
});

describe('admin impersonation disabled (default)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('returns 403 and /me reports the feature as off', async () => {
    const admin = await t.login({ admin: true });
    const user = await t.login();
    expect((await admin.get('/me')).body.impersonationEnabled).toBe(false);
    expectError(await admin.post(`/admin/users/${user.userId}/impersonate`), 403, 'FORBIDDEN');
    expect((await admin.get('/me')).body.id).toBe(admin.userId);
  });
});
