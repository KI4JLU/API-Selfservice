import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Happy path against the running API (dev schema, DEV_LOGIN_ENABLED=true, LITELLM_MODE=mock or http).
 * Every run uses fresh users so it can be repeated without cleanup.
 */

const run = randomUUID().slice(0, 8);
const userEmail = `e2e-user-${run}@test.local`;
const adminEmail = `e2e-admin-${run}@test.local`;
const costCenterNumber = `3${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

async function login(ctx: APIRequestContext, body: { email: string; name?: string; admin?: boolean }) {
  const r = await ctx.post('/api/auth/dev-login', { data: body });
  expect(r.status(), await r.text()).toBe(200);
  const json = (await r.json()) as { ok: boolean; userId: string };
  expect(json.ok).toBe(true);
  return json.userId;
}

test.describe.configure({ mode: 'serial' });

test.describe('API happy path', () => {
  let user: APIRequestContext;
  let admin: APIRequestContext;
  let userId: string;
  let costCenterId: string;
  let keyId: string;

  test.beforeAll(async ({ baseURL }) => {
    // separate cookie jars per role
    user = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: 'http://localhost:5173' } });
    admin = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: 'http://localhost:5173' } });
    userId = await login(user, { email: userEmail, name: 'E2E User' });
    await login(admin, { email: adminEmail, name: 'E2E Admin', admin: true });
  });

  test.afterAll(async () => {
    await user?.dispose();
    await admin?.dispose();
  });

  test('health and docs are public', async ({ request }) => {
    const h = await request.get('/health');
    expect(h.ok()).toBeTruthy();
    const health = (await h.json()) as { ok: boolean; mode: string };
    expect(health.ok).toBe(true);
    expect(['mock', 'http']).toContain(health.mode);
    const spec = await request.get('/api/openapi.json');
    expect(spec.ok()).toBeTruthy();
    expect(Object.keys(((await spec.json()) as { paths: object }).paths).length).toBeGreaterThanOrEqual(30);
    expect((await request.get('/api/docs')).ok()).toBeTruthy();
  });

  test('unauthenticated and CSRF-less requests are refused', async ({ request }) => {
    const r = await request.get('/api/v1/me');
    expect(r.status()).toBe(401);
    expect((await r.json()).code).toBe('UNAUTHORIZED');
    const noOrigin = await user.patch('/api/v1/me', { data: { locale: 'en' }, headers: { Origin: 'https://evil.example' } });
    expect(noOrigin.status()).toBe(403);
    expect((await noOrigin.json()).code).toBe('CSRF_ORIGIN_MISMATCH');
  });

  test('new user starts on the default cost center; admin is admin', async () => {
    const me = await (await user.get('/api/v1/me')).json();
    expect(me).toMatchObject({ id: userId, email: userEmail, role: 'user', effectiveRole: 'user', costCenter: { number: '11111111' }, pendingRequest: null });
    const adminMe = await (await admin.get('/api/v1/me')).json();
    expect(adminMe).toMatchObject({ email: adminEmail, role: 'admin', roleFromIdp: true });
    expect((await user.get('/api/v1/admin/users')).status()).toBe(403);
  });

  test('user requests a cost center, admin approves it', async () => {
    // The owner must be a LiteLLM user (F-KST-14); the requester is one.
    const req = await user.patch('/api/v1/me', { data: { costCenterNumber, costCenterOwnerName: 'Owner', costCenterOwnerEmail: userEmail } });
    expect(req.status(), await req.text()).toBe(200);
    const body = await req.json();
    expect(body.requestCreated).toEqual({ number: costCenterNumber });
    expect(body.costCenter.number).toBe('11111111');
    expect(body.pendingRequest).toMatchObject({ number: costCenterNumber, status: 'pending' });

    const pending = await (await admin.get('/api/v1/cost-center-requests?status=pending&pageSize=200')).json();
    const mine = pending.items.find((r: { user: { id: string } }) => r.user.id === userId);
    expect(mine).toBeDefined();
    const approve = await admin.post(`/api/v1/cost-center-requests/${mine.id}/approve`);
    expect(approve.status(), await approve.text()).toBe(200);
    expect((await approve.json()).status).toBe('approved');

    const me = await (await user.get('/api/v1/me')).json();
    expect(me.costCenter.number).toBe(costCenterNumber);
    costCenterId = me.costCenter.id;
    const cc = await (await user.get(`/api/v1/cost-centers/${costCenterId}`)).json();
    expect(cc).toMatchObject({ number: costCenterNumber, status: 'approved', ownerEmail: userEmail, ownerUserId: userId });
    expect(me.managedCostCenters.map((c: { id: string }) => c.id)).toEqual([costCenterId]);
  });

  test('admin assigns a budget, user sees it', async () => {
    const r = await admin.put(`/api/v1/admin/users/${userId}/budget`, { data: { amount: 25, period: 'monthly' } });
    expect(r.status(), await r.text()).toBe(200);
    expect(await r.json()).toMatchObject({ amount: 25, period: 'monthly' });
    const mine = await (await user.get('/api/v1/me/budget')).json();
    expect(mine).toMatchObject({ amount: 25, period: 'monthly' });
    expect(mine.createdAt).toMatch(ISO);
  });

  test('user creates a key (secret shown once) with models allowed for the cost center', async () => {
    await admin.post('/api/v1/admin/providers/sync');
    const providers = (await (await user.get('/api/v1/providers')).json()) as { modelName: string; tier: string }[];
    expect(providers.length).toBeGreaterThan(0);
    const models = providers.slice(0, 2).map((p) => p.modelName);
    const r = await user.post('/api/v1/api-keys', { data: { name: `e2e-${run}`, models, costCenterId, budget: 5 } });
    expect(r.status(), await r.text()).toBe(201);
    const key = await r.json();
    expect(key.secret).toMatch(/^sk-/);
    expect(key.maskedKey).toContain('…');
    expect(key).toMatchObject({ name: `e2e-${run}`, models, budget: 5, status: 'active', costCenter: { id: costCenterId } });
    expect(key.expiresAt).toMatch(ISO);
    keyId = key.id;

    const list = await (await user.get('/api/v1/api-keys')).json();
    const listed = list.items.find((k: { id: string }) => k.id === keyId);
    expect(listed).toBeDefined();
    expect(listed.secret).toBeUndefined();
    // paid models are refused on the default cost center
    const def = await (await admin.get('/api/v1/cost-centers?q=11111111')).json();
    const paid = providers.find((p) => p.tier === 'paid');
    if (paid) {
      const refused = await user.post('/api/v1/api-keys', { data: { name: 'nope', models: [paid.modelName], costCenterId: def.items[0].id } });
      expect(refused.status()).toBe(409);
      expect((await refused.json()).code).toBe('PAID_MODEL_REQUIRES_COST_CENTER');
    }
  });

  test('ingest runs, spend summary and logs are consistent and only contain own data', async () => {
    const ingest = await admin.post('/api/v1/admin/jobs/ingest');
    expect(ingest.status(), await ingest.text()).toBe(200);
    const res = await ingest.json();
    expect(res).toMatchObject({ fetched: expect.any(Number), inserted: expect.any(Number) });

    const spend = await (await user.get('/api/v1/me/spend')).json();
    expect(spend).toMatchObject({ budget: { amount: 25 }, blocked: false });
    expect(spend.month).toMatch(/^\d{4}-\d{2}$/);
    expect(spend.history).toHaveLength(12);
    expect(spend.metrics.totalRequests).toBe(spend.metrics.successfulRequests + spend.metrics.failedRequests);
    expect(spend.remaining).toBeCloseTo(Math.max(0, 25 - spend.spend), 6);
    for (const k of spend.byKey) expect(k.keyId).toBe(keyId);

    // the spend summary covers the current month; compare with the logs of the same month (mock logs span several days)
    const from = encodeURIComponent(`${spend.month}-01T00:00:00.000Z`);
    const logs = await (await user.get(`/api/v1/me/logs?pageSize=10&from=${from}`)).json();
    expect(logs).toMatchObject({ page: 1, pageSize: 10 });
    expect(logs.total).toBe(spend.metrics.totalRequests);
    for (const l of logs.items) {
      expect(l.keyId).toBe(keyId);
      expect(l.time).toMatch(ISO);
      expect(['success', 'failure']).toContain(l.status);
    }
    const filtered = await (await user.get(`/api/v1/me/logs?keyId=${keyId}&status=success&from=${from}`)).json();
    expect(filtered.total).toBe(spend.metrics.successfulRequests);
    // the admin sees only their own (none) logs
    const adminLogs = await (await admin.get('/api/v1/me/logs')).json();
    expect(adminLogs.items.every((l: { keyId: string }) => l.keyId !== keyId)).toBe(true);
    // reports show the cost center with this user
    const detail = await (await admin.get(`/api/v1/reports/cost-centers/${costCenterId}`)).json();
    expect(detail.summary.costCenter.number).toBe(costCenterNumber);
    expect(detail.summary.keyCount).toBeGreaterThanOrEqual(1);
  });

  test('user extends and deletes the key', async () => {
    const ext = await user.post(`/api/v1/api-keys/${keyId}/extend`);
    expect(ext.status(), await ext.text()).toBe(200);
    expect((await ext.json()).lastExtendedAt).toMatch(ISO);
    const del = await user.delete(`/api/v1/api-keys/${keyId}`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    const list = await (await user.get('/api/v1/api-keys')).json();
    expect(list.items.find((k: { id: string }) => k.id === keyId)).toBeUndefined();
    expect((await user.delete(`/api/v1/api-keys/${keyId}`)).status()).toBe(404);
  });
});
