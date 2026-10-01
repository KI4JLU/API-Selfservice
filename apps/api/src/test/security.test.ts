import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUserSchema, MeSchema, paginated } from '@api-selfservice/shared';
import { LiteLLMHttpError } from '../litellm/types.js';
import { approvedCostCenterFor, CostCenterSchemaLenient, createTestApp, expectError, expectShape, randomCostCenter, uniqEmail, type Client, type TestApp } from './harness.js';

describe('security chain', () => {
  let t: TestApp;
  let admin: Client;
  let user: Client;
  let ccAdmin: Client;
  let ownCc: { id: string; number: string };
  let otherCc: { id: string; number: string };

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    user = await t.login();
    ccAdmin = await t.login();
    ownCc = await approvedCostCenterFor(t, admin, ccAdmin);
    otherCc = await approvedCostCenterFor(t, admin, user);
  });
  afterAll(() => t.close());

  describe('step 1: session', () => {
    it('401 UNAUTHORIZED without a session cookie', async () => {
      for (const path of ['/me', '/api-keys', '/providers', '/admin/users', '/reports/cost-centers']) {
        expectError(await t.anonymous().get(path), 401, 'UNAUTHORIZED');
      }
      expectError(await t.anonymous().post('/api-keys', { name: 'x' }), 401, 'UNAUTHORIZED');
    });

    it('401 with a garbage cookie', async () => {
      const r = await t.request('GET', '/api/v1/me', { cookie: 'api-selfservice.session_token=abc.def' });
      expectError(r, 401, 'UNAUTHORIZED');
    });

    it('public routes need no session', async () => {
      expect((await t.request('GET', '/health')).status).toBe(200);
      expect((await t.request('GET', '/api/openapi.json')).status).toBe(200);
    });
  });

  describe('step 2: CSRF', () => {
    it('mutating request without Origin -> CSRF_ORIGIN_MISMATCH', async () => {
      expectError(await user.patch('/me', { locale: 'en' }, { origin: null }), 403, 'CSRF_ORIGIN_MISMATCH');
      expectError(await user.post('/cost-centers', {}, { origin: null }), 403, 'CSRF_ORIGIN_MISMATCH');
      expectError(await user.delete('/api-keys/x', undefined, { origin: null }), 403, 'CSRF_ORIGIN_MISMATCH');
      expectError(await admin.put('/admin/users/x/budget', {}, { origin: null }), 403, 'CSRF_ORIGIN_MISMATCH');
    });

    it('mutating request with a foreign Origin -> CSRF_ORIGIN_MISMATCH', async () => {
      expectError(await user.patch('/me', { locale: 'en' }, { origin: 'https://evil.example' }), 403, 'CSRF_ORIGIN_MISMATCH');
      expectError(await user.patch('/me', { locale: 'en' }, { origin: 'http://localhost:5174' }), 403, 'CSRF_ORIGIN_MISMATCH');
    });

    it('accepts APP_URL and API_URL as Origin, and a trusted Referer', async () => {
      expect((await user.patch('/me', { locale: 'en' }, { origin: 'http://localhost:5173' })).status).toBe(200);
      expect((await user.patch('/me', { locale: 'de' }, { origin: 'http://localhost:3030' })).status).toBe(200);
      expect((await user.patch('/me', { locale: 'de' }, { origin: null, headers: { referer: 'http://localhost:5173/profile' } })).status).toBe(200);
    });

    it('GET is allowed without Origin', async () => {
      const r = await user.get('/me', { origin: null });
      expect(r.status).toBe(200);
    });
  });

  describe('step 3: roles', () => {
    it('user gets FORBIDDEN on /admin/*', async () => {
      const gets = ['/admin/users', `/admin/users/${user.userId}`, '/admin/api-keys', '/admin/providers', '/admin/budgets', '/admin/notifications', '/cost-center-requests'];
      for (const p of gets) expectError(await user.get(p), 403, 'FORBIDDEN');
      expectError(await user.post('/admin/providers/sync'), 403, 'FORBIDDEN');
      expectError(await user.post('/admin/cost-centers', { number: '22222222', name: 'x', ownerName: 'o', ownerEmail: 'o@x.de' }), 403, 'FORBIDDEN');
      expectError(await user.put(`/admin/users/${user.userId}/budget`, { amount: 1, period: 'monthly' }), 403, 'FORBIDDEN');
      expectError(await user.patch(`/admin/users/${user.userId}/role`, { role: 'admin' }), 403, 'FORBIDDEN');
      expectError(await user.post(`/admin/users/${user.userId}/deactivate`), 403, 'FORBIDDEN');
      expectError(await user.post('/admin/jobs/ingest'), 403, 'FORBIDDEN');
      expectError(await user.post('/admin/jobs/key-expiry'), 403, 'FORBIDDEN');
      expectError(await user.post(`/admin/cost-centers/${otherCc.id}/archive`), 403, 'FORBIDDEN');
      expectError(await user.post('/admin/api-keys/x/block', { blocked: true }), 403, 'FORBIDDEN');
    });

    it('user gets FORBIDDEN on /reports/* and /cost-centers/managed', async () => {
      expectError(await user.get('/reports/cost-centers'), 403, 'FORBIDDEN');
      expectError(await user.get(`/reports/cost-centers/${otherCc.id}`), 403, 'FORBIDDEN');
      expectError(await user.get('/cost-centers/managed'), 403, 'FORBIDDEN');
    });

    it('user cannot PATCH a cost center (even the own one)', async () => {
      expectError(await user.patch(`/cost-centers/${otherCc.id}`, { maxBudget: 5 }), 403, 'FORBIDDEN');
    });

    it('cost-center-admin assignment via PUT /admin/users/:id/cost-center-admin', async () => {
      const r = await admin.put(`/admin/users/${ccAdmin.userId}/cost-center-admin`, { costCenterIds: [ownCc.id] });
      expect(r.status).toBe(200);
      const body = expectShape(AdminUserSchema, r.body);
      expect(body.managedCostCenters.map((c) => c.id)).toEqual([ownCc.id]);
      const me = expectShape(MeSchema, (await ccAdmin.get('/me')).body);
      expect(me.effectiveRole).toBe('cost_center_admin');
      expect(me.role).toBe('user');
      expect(await t.notificationsOf('role_changed', ccAdmin.email)).toHaveLength(1);
    });

    it('unknown cost center id in assignment -> NOT_FOUND', async () => {
      expectError(await admin.put(`/admin/users/${ccAdmin.userId}/cost-center-admin`, { costCenterIds: [ownCc.id, 'nope'] }), 404, 'NOT_FOUND');
    });
  });

  describe('step 4: scope', () => {
    it('cost_center_admin can set maxBudget of the own cost center', async () => {
      const r = await ccAdmin.patch(`/cost-centers/${ownCc.id}`, { maxBudget: 42, budgetPeriod: 'monthly' });
      expect(r.status).toBe(200);
      const cc = expectShape(CostCenterSchemaLenient, r.body);
      expect(cc.maxBudget).toBe(42);
      expect(cc.budgetPeriod).toBe('monthly');
    });

    it('cost_center_admin cannot touch another cost center', async () => {
      expectError(await ccAdmin.patch(`/cost-centers/${otherCc.id}`, { maxBudget: 42 }), 403, 'FORBIDDEN');
    });

    it('cost_center_admin cannot change name / owner of the own cost center', async () => {
      expectError(await ccAdmin.patch(`/cost-centers/${ownCc.id}`, { name: 'renamed' }), 403, 'FORBIDDEN');
      expectError(await ccAdmin.patch(`/cost-centers/${ownCc.id}`, { ownerUserId: ccAdmin.userId }), 403, 'FORBIDDEN');
      const cc = await admin.get(`/cost-centers/${ownCc.id}`);
      expect(cc.body.name).not.toBe('renamed');
    });

    it('cost_center_admin sees only assigned cost centers under /managed and /reports', async () => {
      const managed = expectShape(paginated(CostCenterSchemaLenient), (await ccAdmin.get('/cost-centers/managed')).body);
      expect(managed.items.map((c) => c.id)).toEqual([ownCc.id]);
      const rep = await ccAdmin.get('/reports/cost-centers');
      expect(rep.status).toBe(200);
      expect((rep.body as { costCenter: { id: string } }[]).map((r) => r.costCenter.id)).toEqual([ownCc.id]);
      expectError(await ccAdmin.get(`/reports/cost-centers/${otherCc.id}`), 403, 'FORBIDDEN');
      expect((await ccAdmin.get(`/reports/cost-centers/${ownCc.id}`)).status).toBe(200);
    });

    it('admin sees only cost centers assigned as cost center admin under /managed', async () => {
      const managed = expectShape(paginated(CostCenterSchemaLenient), (await admin.get('/cost-centers/managed')).body);
      expect(managed.items).toEqual([]);
    });

    it('cost_center_admin still has no admin rights', async () => {
      expectError(await ccAdmin.get('/admin/users'), 403, 'FORBIDDEN');
      expectError(await ccAdmin.post(`/admin/cost-centers/${ownCc.id}/archive`), 403, 'FORBIDDEN');
    });

    it('admin passes everything', async () => {
      expect((await admin.get('/admin/users')).status).toBe(200);
      expect((await admin.get('/cost-centers/managed')).status).toBe(200);
      expect((await admin.get('/reports/cost-centers')).status).toBe(200);
      expect((await admin.get(`/reports/cost-centers/${otherCc.id}`)).status).toBe(200);
      expect((await admin.patch(`/cost-centers/${otherCc.id}`, { name: 'Admin renamed', maxBudget: 7 })).status).toBe(200);
      expect((await admin.patch(`/cost-centers/${ownCc.id}`, { maxBudget: null })).status).toBe(200);
    });
  });

  describe('account state', () => {
    it('deactivated user gets ACCOUNT_DEACTIVATED on every route', async () => {
      const victim = await t.login();
      expect((await admin.post(`/admin/users/${victim.userId}/deactivate`)).status).toBe(200);
      expectError(await victim.get('/me'), 403, 'ACCOUNT_DEACTIVATED');
      expectError(await victim.get('/api-keys'), 403, 'ACCOUNT_DEACTIVATED');
      expectError(await victim.patch('/me', { locale: 'en' }), 403, 'ACCOUNT_DEACTIVATED');
      // reactivation restores access
      expect((await admin.post(`/admin/users/${victim.userId}/reactivate`)).status).toBe(200);
      expect((await victim.get('/me')).status).toBe(200);
    });

    it('user with invalid affiliation gets ACCOUNT_INVALID_AFFILIATION', async () => {
      const u = await t.login();
      const { user: userTable, eq } = await import('@api-selfservice/db');
      await t.db.update(userTable).set({ affiliationValid: false }).where(eq(userTable.id, u.userId));
      expectError(await u.get('/me'), 403, 'ACCOUNT_INVALID_AFFILIATION');
    });
  });

  describe('response schemas', () => {
    it('validation errors carry code VALIDATION_ERROR and details', async () => {
      const r = await user.patch('/me', { locale: 'fr' });
      expectError(r, 400, 'VALIDATION_ERROR');
      expect(Array.isArray(r.body.details)).toBe(true);
    });

    it('unknown routes under /api/v1 return 404 for a signed-in user', async () => {
      expect((await user.get('/does-not-exist')).status).toBe(404);
    });

    it('x-request-id is echoed', async () => {
      const r = await user.get('/me', { headers: { 'x-request-id': 'req-123' } });
      expect(r.headers.get('x-request-id')).toBe('req-123');
    });

    it('a client request id is only taken over when short and plain (it ends up in logs)', async () => {
      for (const id of ['x'.repeat(101), 'two words', '<script>']) {
        const r = await user.get('/me', { headers: { 'x-request-id': id } });
        expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      }
    });
  });

  describe('hardening (security review 2026-10-01)', () => {
    it('a malformed Referer is refused like a missing Origin, not with a 500', async () => {
      expectError(await user.patch('/me', { locale: 'de' }, { origin: null, headers: { referer: 'not a url' } }), 403, 'CSRF_ORIGIN_MISMATCH');
    });

    it('LiteLLM error texts go to the event log, never to the client', async () => {
      const orig = t.mock.listUsers;
      t.mock.listUsers = async () => {
        throw new LiteLLMHttpError(500, 'internal detail of the proxy', '/user/list');
      };
      let r;
      try {
        r = await admin.get('/admin/litellm-users?q=xyz', { headers: { 'x-request-id': 'req-litellm-err' } });
      } finally {
        t.mock.listUsers = orig;
      }
      expectError(r, 502, 'LITELLM_ERROR');
      expect(JSON.stringify(r.body)).not.toContain('internal detail');
      expect(JSON.stringify(r.body)).not.toContain('/user/list');
      const events = await admin.get('/admin/events?entityId=req-litellm-err');
      expect(JSON.stringify(events.body)).toContain('internal detail of the proxy');
    });

    it('models of a cost center are only listed for its members and admins', async () => {
      expect((await user.get(`/providers?costCenterId=${otherCc.id}`)).status).toBe(200);
      expectError(await user.get(`/providers?costCenterId=${ownCc.id}`), 403, 'FORBIDDEN');
      const defaultId = (await user.get('/me')).body.memberCostCenters[0].id as string;
      expect((await user.get(`/providers?costCenterId=${defaultId}`)).status).toBe(200);
      expect((await admin.get(`/providers?costCenterId=${ownCc.id}`)).status).toBe(200);
    });

    it('users cannot rename themselves through Better Auth', async () => {
      const before = (await user.get('/me')).body.name;
      const r = await t.request('POST', '/api/auth/update-user', { body: { name: 'Mallory' }, cookie: user.cookie });
      expect(r.status).toBe(404);
      expect((await user.get('/me')).body.name).toBe(before);
    });

    it('owner e-mails in requests: one answer for unknown and deactivated accounts, failed lookups capped per user', async () => {
      const prober = await t.login();
      const gone = await t.login();
      expect((await admin.post(`/admin/users/${gone.userId}/deactivate`)).status).toBe(200);
      const ask = (c: Client, ownerEmail: string) => c.post('/cost-centers', { number: randomCostCenter(), name: 'probe', ownerEmail });
      expectError(await ask(prober, gone.email), 409, 'OWNER_NOT_LITELLM_USER');
      for (let i = 0; i < 4; i++) expectError(await ask(prober, uniqEmail('nobody')), 409, 'OWNER_NOT_LITELLM_USER');
      expectError(await ask(prober, uniqEmail('nobody')), 429, 'RATE_LIMITED');
      // other users are not affected; after an hour the prober may try again
      expectError(await ask(user, uniqEmail('nobody')), 409, 'OWNER_NOT_LITELLM_USER');
      const saved = t.clock.now;
      t.clock.now = new Date(saved.getTime() + 61 * 60_000);
      try {
        expectError(await ask(prober, uniqEmail('nobody')), 409, 'OWNER_NOT_LITELLM_USER');
      } finally {
        t.clock.now = saved;
      }
    });
  });
});

describe('API docs with API_DOCS_ADMIN_ONLY (always on in production)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ API_DOCS_ADMIN_ONLY: 'true' });
  });
  afterAll(() => t.close());

  it('only signed-in admins get the spec and the docs', async () => {
    const user = await t.login();
    const admin = await t.login({ admin: true });
    for (const path of ['/api/openapi.json', '/api/docs']) {
      expectError(await t.request('GET', path), 401, 'UNAUTHORIZED');
      expectError(await t.request('GET', path, { cookie: user.cookie }), 403, 'FORBIDDEN');
      expect((await t.request('GET', path, { cookie: admin.cookie })).status).toBe(200);
    }
    expect((await t.request('GET', '/health')).status).toBe(200);
  });
});
