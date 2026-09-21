import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MeSchema } from '@litelite/shared';
import { eq, user as userTable } from '@litelite/db';
import { createTestApp, expectShape, uniq, uniqEmail, type TestApp } from './harness.js';

describe('auth / onboarding', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('first dev-login creates the user with the default cost center and a LiteLLM user', async () => {
    const email = uniqEmail('new');
    const u = await t.login({ email, name: 'New Person' });
    const me = expectShape(MeSchema, (await u.get('/me')).body);
    expect(me.email).toBe(email);
    expect(me.name).toBe('New Person');
    expect(me.role).toBe('user');
    expect(me.effectiveRole).toBe('user');
    expect(me.roleFromIdp).toBe(false);
    expect(me.locale).toBe('de');
    expect(me.costCenter.number).toBe('11111111');
    expect(me.managedCostCenters).toEqual([]);
    expect(me.pendingRequest).toBeNull();
    // LiteLLM user registered (mock) under the same id (E-7) and member of the default team (E-8)
    const row = await t.db.query.user.findFirst({ where: eq(userTable.id, u.userId) });
    expect(t.mock.users.get(u.userId)?.email).toBe(email);
    expect(t.mock.teams.get(me.costCenter.id)?.members.get(u.userId)).toBe('user');
    expect(row?.lastLoginAt).not.toBeNull();
  });

  it('adopts an existing LiteLLM user with the same e-mail instead of creating a second one (E-7)', async () => {
    const email = uniqEmail('adopt');
    const legacyId = `legacy-${uniq()}`;
    await t.mock.createUser({ userId: legacyId, email: email.toUpperCase(), alias: 'Legacy' });
    const u = await t.login({ email });
    expect(u.userId).toBe(legacyId);
    expect((await u.get('/me')).body.id).toBe(legacyId);
    expect([...t.mock.users.values()].filter((x) => x.email.toLowerCase() === email)).toHaveLength(1);
    expect(t.mock.users.get(legacyId)?.alias).toBe('Legacy');
    expect(t.mock.teams.get((await u.get('/me')).body.costCenter.id)?.members.get(legacyId)).toBe('user');
  });

  it('default name is derived from the email local part', async () => {
    const email = uniqEmail('local');
    const u = await t.login({ email });
    expect((await u.get('/me')).body.name).toBe(email.split('@')[0]);
  });

  it('second login reuses the user and only issues a new session', async () => {
    const email = uniqEmail('again');
    const a = await t.login({ email });
    const b = await t.login({ email });
    expect(a.userId).toBe(b.userId);
    expect(a.cookie).not.toBe(b.cookie);
    expect((await a.get('/me')).status).toBe(200);
    expect((await b.get('/me')).status).toBe(200);
    const users = await t.db.query.user.findMany({ where: eq(userTable.email, email) });
    expect(users).toHaveLength(1);
  });

  it('dev-login with admin:true yields role admin managed by the IdP', async () => {
    const a = await t.login({ admin: true });
    const me = expectShape(MeSchema, (await a.get('/me')).body);
    expect(me.role).toBe('admin');
    expect(me.effectiveRole).toBe('admin');
    expect(me.roleFromIdp).toBe(true);
  });

  it('dev-login with affiliation stores it as valid', async () => {
    const u = await t.login({ affiliation: ['member'] });
    const row = await t.db.query.user.findFirst({ where: eq(userTable.id, u.userId) });
    expect(row?.affiliation).toEqual(['member']);
    expect(row?.affiliationValid).toBe(true);
  });

  it('dev-login validates the body', async () => {
    const r = await t.request('POST', '/api/auth/dev-login', { body: { email: 'not-an-email' } });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('dev-login is unavailable when DEV_LOGIN_ENABLED is false', async () => {
    const t2 = await createTestApp({ DEV_LOGIN_ENABLED: 'false' });
    try {
      const r = await t2.request('POST', '/api/auth/dev-login', { body: { email: uniqEmail() } });
      expect(r.status).toBe(404);
    } finally {
      await t2.close();
    }
  });

  it('logout invalidates the session', async () => {
    const u = await t.login();
    const out = await t.request('POST', '/api/auth/sign-out', { cookie: u.cookie, body: {} });
    expect(out.status).toBe(200);
    expect((await u.get('/me')).status).toBe(401);
  });
});
