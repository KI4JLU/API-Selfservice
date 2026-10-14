import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminApiKeySchema, ApiKeySchema, CreatedApiKeySchema, paginated } from '@api-selfservice/shared';
import { apiKeys, eq } from '@api-selfservice/db';
import { approvedCostCenterFor, createTestApp, DAY, expectError, expectShape, syncProvidersWithFree, type Client, type TestApp } from './harness.js';

describe('api keys', () => {
  let t: TestApp;
  let admin: Client;
  let user: Client;
  let other: Client;
  let cc: { id: string; number: string };
  let defaultId: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    await syncProvidersWithFree(admin);
    user = await t.login();
    other = await t.login();
    cc = await approvedCostCenterFor(t, admin, user);
    defaultId = (await other.get('/me')).body.costCenter.id;
  });
  afterAll(() => t.close());

  const create = (c: Client, body: Record<string, unknown> = {}) => c.post('/api-keys', { name: 'key', models: ['gpt-4o'], costCenterId: cc.id, ...body });

  it('create returns the secret exactly once together with the masked key', async () => {
    const r = await create(user, { name: 'first', models: ['gpt-4o', 'claude-sonnet-5'], budget: 2.5 });
    expect(r.status).toBe(201);
    const k = expectShape(CreatedApiKeySchema, r.body);
    expect(k.secret).toMatch(/^sk-[0-9a-f]{48}$/);
    expect(k.maskedKey).toBe(`${k.secret.slice(0, 6)}…${k.secret.slice(-4)}`);
    expect(k).toMatchObject({ name: 'first', models: ['gpt-4o', 'claude-sonnet-5'], budget: 2.5, spend: 0, status: 'active', lastExtendedAt: null, costCenter: { id: cc.id, number: cc.number } });
    expect(new Date(k.expiresAt).getTime()).toBe(t.clock.now.getTime() + 182 * DAY);
    // stored in LiteLLM (mock) under the user with alias email:name
    const row = await t.keyRow(k.id);
    const mk = t.mock.keys.get(row.litellmKeyId)!;
    expect(mk).toMatchObject({ alias: `${user.email}:first`, models: ['gpt-4o', 'claude-sonnet-5'], maxBudget: 2.5, blocked: false, userId: user.userId, teamId: cc.id });
    // the plaintext is never stored
    expect(JSON.stringify(row)).not.toContain(k.secret);

    const list = expectShape(paginated(ApiKeySchema), (await user.get('/api-keys')).body);
    expect(list.total).toBe(1);
    expect(list.items[0]!.id).toBe(k.id);
    expect((list.items[0] as { secret?: string }).secret).toBeUndefined();
  });

  it('validates the create body', async () => {
    expectError(await create(user, { models: [] }), 400, 'VALIDATION_ERROR');
    expectError(await create(user, { name: '' }), 400, 'VALIDATION_ERROR');
    expectError(await create(user, { name: 'x'.repeat(101) }), 400, 'VALIDATION_ERROR');
    expectError(await create(user, { budget: -1 }), 400, 'VALIDATION_ERROR');
    expectError(await create(user, { costCenterId: 'nope' }), 404, 'NOT_FOUND');
  });

  it('key budgets may not exceed the user budget', async () => {
    const u = await t.login();
    const ucc = await approvedCostCenterFor(t, admin, u);
    // no user budget: any key budget is fine
    expect((await u.post('/api-keys', { name: 'a', models: ['gpt-4o'], costCenterId: ucc.id, budget: 1000 })).status).toBe(201);
    expect((await admin.put(`/admin/users/${u.userId}/budget`, { amount: 10, period: 'monthly' })).status).toBe(200);
    // existing 1000 already exceeds: any additional budget fails, keys without budget still work
    expectError(await u.post('/api-keys', { name: 'b', models: ['gpt-4o'], costCenterId: ucc.id, budget: 1 }), 409, 'KEY_BUDGET_EXCEEDS_USER_BUDGET');
    const first = (await u.get('/api-keys')).body.items[0];
    expect((await u.patch(`/api-keys/${first.id}`, { budget: 6 })).status).toBe(200);
    const b = await u.post('/api-keys', { name: 'b', models: ['gpt-4o'], costCenterId: ucc.id, budget: 4 });
    expect(b.status).toBe(201);
    expectError(await u.post('/api-keys', { name: 'c', models: ['gpt-4o'], costCenterId: ucc.id, budget: 0.01 }), 409, 'KEY_BUDGET_EXCEEDS_USER_BUDGET');
    expectError(await u.patch(`/api-keys/${b.body.id}`, { budget: 4.5 }), 409, 'KEY_BUDGET_EXCEEDS_USER_BUDGET');
    expect((await u.post('/api-keys', { name: 'c', models: ['gpt-4o'], costCenterId: ucc.id })).status).toBe(201);
    // deleting a key frees its share (F-BUD-6)
    expect((await u.delete(`/api-keys/${b.body.id}`)).status).toBe(200);
    expect((await u.post('/api-keys', { name: 'd', models: ['gpt-4o'], costCenterId: ucc.id, budget: 4 })).status).toBe(201);
  });

  it('PATCH updates budget and name (synced to LiteLLM)', async () => {
    const k = (await create(user, { name: 'patchme', budget: 1 })).body;
    const r = await user.patch(`/api-keys/${k.id}`, { name: 'renamed', budget: 3 });
    expect(r.status).toBe(200);
    const v = expectShape(ApiKeySchema, r.body);
    expect(v).toMatchObject({ id: k.id, name: 'renamed', budget: 3 });
    const mk = t.mock.keys.get(await t.litellmKeyIdOf(k.id))!;
    expect(mk.alias).toBe(`${user.email}:renamed`);
    expect(mk.maxBudget).toBe(3);
    // budget can be removed
    expect((await user.patch(`/api-keys/${k.id}`, { budget: null })).body.budget).toBeNull();
    expect(mk.maxBudget).toBeNull();
    expectError(await user.patch(`/api-keys/${k.id}`, { name: '' }), 400, 'VALIDATION_ERROR');
  });

  it('a key budget resets monthly or applies once; monthly keys show this month’s spend (F-KEY-11)', async () => {
    const once = expectShape(CreatedApiKeySchema, (await create(user, { name: 'once', budget: 5 })).body);
    expect(once.budgetPeriod).toBeNull();
    expect(t.mock.keys.get(await t.litellmKeyIdOf(once.id))!.budgetDuration).toBeNull();

    const k = expectShape(CreatedApiKeySchema, (await create(user, { name: 'monthly', budget: 5, budgetPeriod: 'monthly' })).body);
    expect(k).toMatchObject({ budget: 5, budgetPeriod: 'monthly' });
    const mk = t.mock.keys.get(await t.litellmKeyIdOf(k.id))!;
    expect(mk.budgetDuration).toBe('30d');
    // last month's spend does not count against this month's budget
    await t.storeLogs([await t.addLog(k.id, { spend: 2, startTime: '2026-08-20T10:00:00.000Z' })]);
    await t.addLog(k.id, { spend: 0.5 });
    await t.ingest();
    expect((await user.get('/api-keys')).body.items.find((x: { id: string }) => x.id === k.id).spend).toBe(0.5);

    // switching to "once" and back is mirrored; removing the amount removes the period
    expect((await user.patch(`/api-keys/${k.id}`, { budgetPeriod: null })).body).toMatchObject({ budgetPeriod: null, spend: 2.5 });
    expect(mk.budgetDuration).toBeNull();
    expect((await user.patch(`/api-keys/${k.id}`, { budgetPeriod: 'monthly' })).body.budgetPeriod).toBe('monthly');
    expect(mk.budgetDuration).toBe('30d');
    expect((await user.patch(`/api-keys/${k.id}`, { budget: null })).body).toMatchObject({ budget: null, budgetPeriod: null });
    expect(mk.budgetDuration).toBeNull();
    // a period without an amount is ignored
    expect((await create(user, { name: 'no-amount', budgetPeriod: 'monthly' })).body.budgetPeriod).toBeNull();
    expectError(await create(user, { budget: 1, budgetPeriod: 'weekly' }), 400, 'VALIDATION_ERROR');
  });

  it('DELETE marks the key deleted, removes it from LiteLLM and keeps its spend in reports', async () => {
    const k = (await create(user, { name: 'doomed' })).body;
    const litellmKeyId = await t.litellmKeyIdOf(k.id);
    await t.addLog(k.id, { spend: 1.25, model: 'gpt-4o' });
    await t.ingest();
    expect((await user.get('/api-keys')).body.items.find((x: { id: string }) => x.id === k.id).spend).toBe(1.25);

    const r = await user.delete(`/api-keys/${k.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect((await user.get('/api-keys')).body.items.find((x: { id: string }) => x.id === k.id)).toBeUndefined();
    expect(t.mock.keys.has(litellmKeyId)).toBe(false);
    const row = await t.keyRow(k.id);
    expect(row.status).toBe('deleted');
    expect(row.deletedAt).not.toBeNull();
    // spend remains attributed
    const spend = await user.get('/me/spend');
    expect(spend.body.byKey.find((x: { keyId: string }) => x.keyId === k.id)).toMatchObject({ keyName: 'doomed', spend: 1.25 });
    const detail = await admin.get(`/reports/cost-centers/${cc.id}`);
    const me = detail.body.users.find((u: { user: { id: string } }) => u.user.id === user.userId);
    expect(me.keys.find((x: { keyId: string }) => x.keyId === k.id)).toMatchObject({ keyName: 'doomed', spend: 1.25 });
    // gone for further operations
    expectError(await user.delete(`/api-keys/${k.id}`), 404, 'NOT_FOUND');
    expectError(await user.patch(`/api-keys/${k.id}`, { name: 'x' }), 404, 'NOT_FOUND');
    expectError(await user.post(`/api-keys/${k.id}/renew`, {}), 404, 'NOT_FOUND');
    expect((await admin.get('/admin/api-keys')).body.items.find((x: { id: string }) => x.id === k.id)).toBeUndefined();
    expect((await admin.get('/admin/api-keys?status=deleted')).body.items.find((x: { id: string }) => x.id === k.id)).toBeDefined();
  });

  describe('expiry and renewal (#11)', () => {
    const iso = (days: number) => new Date(t.clock.now.getTime() + days * DAY).toISOString();

    it('the expiry is chosen at creation, at most KEY_LIFETIME_DAYS ahead', async () => {
      const k = expectShape(CreatedApiKeySchema, (await create(user, { name: 'workshop', expiresAt: iso(30) })).body);
      expect(k.expiresAt).toBe(iso(30));
      expect(k.maxExpiresAt).toBe(iso(182));
      expect(t.mock.keys.get(await t.litellmKeyIdOf(k.id))!.expires).toBe(iso(30));
      // the end of the last allowed day is capped to the limit
      expect((await create(user, { name: 'last-day', expiresAt: iso(182.5) })).body.expiresAt).toBe(iso(182));
      expectError(await create(user, { name: 'too-long', expiresAt: iso(184) }), 422, 'KEY_EXPIRY_OUT_OF_RANGE');
      expectError(await create(user, { name: 'past', expiresAt: iso(-1) }), 422, 'KEY_EXPIRY_OUT_OF_RANGE');
      expectError(await create(user, { name: 'bad', expiresAt: 'tomorrow' }), 400, 'VALIDATION_ERROR');
    });

    it('the expiry can be shortened and moved back out to creation + KEY_LIFETIME_DAYS, not further', async () => {
      const k = (await create(user, { name: 'change-expiry' })).body;
      await t.db.update(apiKeys).set({ notified14d: true, notified1d: true }).where(eq(apiKeys.id, k.id));
      t.clock.now = new Date(t.clock.now.getTime() + 10 * DAY);
      const shorter = await user.patch(`/api-keys/${k.id}`, { expiresAt: iso(5) });
      expect(shorter.status).toBe(200);
      expect(expectShape(ApiKeySchema, shorter.body).expiresAt).toBe(iso(5));
      expect(t.mock.keys.get(await t.litellmKeyIdOf(k.id))!.expires).toBe(iso(5));
      // later again: up to 182 days after creation (= 172 days from now), warnings start over
      const later = await user.patch(`/api-keys/${k.id}`, { expiresAt: iso(172) });
      expect(later.body.expiresAt).toBe(iso(172));
      expect((await t.keyRow(k.id)).notified14d).toBe(false);
      expectError(await user.patch(`/api-keys/${k.id}`, { expiresAt: iso(180) }), 422, 'KEY_EXPIRY_OUT_OF_RANGE');
      t.clock.now = new Date(t.clock.now.getTime() - 10 * DAY);
    });

    it('a key past its expiry shows as expired right away and runs again with a new date in range', async () => {
      const k = (await create(user, { name: 'short', expiresAt: iso(2) })).body;
      t.clock.now = new Date(t.clock.now.getTime() + 3 * DAY);
      expect((await user.get('/api-keys')).body.items.find((x: { id: string }) => x.id === k.id).status).toBe('expired');
      const r = await user.patch(`/api-keys/${k.id}`, { expiresAt: iso(30) });
      expect(r.body.status).toBe('active');
      t.clock.now = new Date(t.clock.now.getTime() - 3 * DAY);
    });

    it('renew creates a new key with the same settings; the old one stays valid until it expires', async () => {
      const old = expectShape(CreatedApiKeySchema, (await create(user, { name: 'rotate', models: ['gpt-4o'], providers: ['anthropic'], budget: 1.5, budgetPeriod: 'monthly' })).body);
      const r = await user.post(`/api-keys/${old.id}/renew`, { expiresAt: iso(90) });
      expect(r.status).toBe(201);
      const fresh = expectShape(CreatedApiKeySchema, r.body);
      expect(fresh.id).not.toBe(old.id);
      expect(fresh.secret).not.toBe(old.secret);
      expect(fresh).toMatchObject({ name: 'rotate', providers: ['anthropic'], budget: 1.5, budgetPeriod: 'monthly', costCenter: { id: cc.id }, expiresAt: iso(90), status: 'active' });
      expect([...fresh.models].sort()).toEqual([...old.models].sort());
      // the LiteLLM alias must be unique there, so the new key gets a suffix
      expect(t.mock.keys.get(await t.litellmKeyIdOf(fresh.id))!.alias).toMatch(new RegExp(`^${user.email}:rotate #[0-9a-f]{6}$`));
      expect((await t.keyRow(old.id)).status).toBe('active');
      const events = await admin.get(`/admin/events?entity=api_key&pageSize=50`);
      expect(JSON.stringify(events.body)).toContain('key.renew');
    });

    it('renew with revokeOld deletes the old key; expired keys can be renewed', async () => {
      const old = (await create(user, { name: 'revoke' })).body;
      const fresh = await user.post(`/api-keys/${old.id}/renew`, { revokeOld: true });
      expect(fresh.status).toBe(201);
      expect((await t.keyRow(old.id)).status).toBe('deleted');
      expect(t.mock.keys.get((await t.keyRow(old.id)).litellmKeyId)).toBeUndefined();

      const expiring = (await create(user, { name: 'expired', expiresAt: iso(1) })).body;
      t.clock.now = new Date(t.clock.now.getTime() + 2 * DAY);
      expect((await user.post(`/api-keys/${expiring.id}/renew`, {})).status).toBe(201);
      t.clock.now = new Date(t.clock.now.getTime() - 2 * DAY);
    });
  });

  it("another user's key -> FORBIDDEN, unknown key -> NOT_FOUND", async () => {
    const k = (await create(user, { name: 'mine' })).body;
    expectError(await other.patch(`/api-keys/${k.id}`, { name: 'stolen' }), 403, 'FORBIDDEN');
    expectError(await other.delete(`/api-keys/${k.id}`), 403, 'FORBIDDEN');
    expectError(await other.post(`/api-keys/${k.id}/renew`, {}), 403, 'FORBIDDEN');
    expect((await other.get('/api-keys')).body.items.find((x: { id: string }) => x.id === k.id)).toBeUndefined();
    expectError(await other.patch('/api-keys/does-not-exist', { name: 'x' }), 404, 'NOT_FOUND');
    expectError(await other.delete('/api-keys/does-not-exist'), 404, 'NOT_FOUND');
    // keys only on the default or on cost centers the user is a member of (F-KST-12)
    expectError(await other.post('/api-keys', { name: 'x', models: ['gemma-local'], costCenterId: cc.id }), 409, 'COST_CENTER_NOT_MEMBER');
    expect((await other.post('/api-keys', { name: 'x', models: ['gemma-local'], costCenterId: defaultId })).status).toBe(201);
    expect(t.mock.keys.get(await t.litellmKeyIdOf(k.id))).toBeDefined();
  });

  it('admin lists all keys with owners and can block / unblock', async () => {
    const k = (await create(user, { name: 'blockme' })).body;
    const list = expectShape(paginated(AdminApiKeySchema), (await admin.get('/admin/api-keys')).body);
    expect(list.total).toBeGreaterThanOrEqual(3);
    const mine = list.items.find((x) => x.id === k.id)!;
    expect(mine.user).toEqual({ id: user.userId, name: expect.any(String), email: user.email });
    const byUser = await admin.get(`/admin/api-keys?userId=${other.userId}`);
    expect(byUser.body.items.every((x: { user: { id: string } }) => x.user.id === other.userId)).toBe(true);
    expect(byUser.body.total).toBeGreaterThanOrEqual(1);
    const byCc = await admin.get(`/admin/api-keys?costCenterId=${cc.id}&pageSize=1`);
    expect(byCc.body.items).toHaveLength(1);
    expect(byCc.body.items[0].costCenter.id).toBe(cc.id);

    const b = await admin.post(`/admin/api-keys/${k.id}/block`, { blocked: true });
    expect(b.status).toBe(200);
    expect(expectShape(AdminApiKeySchema, b.body).status).toBe('blocked');
    expect((await t.keyRow(k.id)).blockedReason).toBe('admin');
    expect(t.mock.keys.get(await t.litellmKeyIdOf(k.id))!.blocked).toBe(true);
    expect((await user.get('/api-keys')).body.items.find((x: { id: string }) => x.id === k.id).status).toBe('blocked');
    // a key blocked by an admin cannot be replaced by a renewal (#11)
    expectError(await user.post(`/api-keys/${k.id}/renew`, {}), 409, 'KEY_NOT_ACTIVE');
    expect((await admin.get('/admin/api-keys?status=blocked')).body.items.map((x: { id: string }) => x.id)).toContain(k.id);

    const u = await admin.post(`/admin/api-keys/${k.id}/block`, { blocked: false });
    expect(u.body.status).toBe('active');
    expect(t.mock.keys.get(await t.litellmKeyIdOf(k.id))!.blocked).toBe(false);
    expectError(await admin.post('/admin/api-keys/nope/block', { blocked: true }), 404, 'NOT_FOUND');
  });
});

describe('provider keys (F-KEY-10)', () => {
  let t: TestApp;
  let admin: Client;
  let user: Client;
  let cc: { id: string; number: string };
  let defaultId: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    await syncProvidersWithFree(admin);
    user = await t.login();
    defaultId = (await user.get('/me')).body.costCenter.id;
    cc = await approvedCostCenterFor(t, admin, user);
  });
  afterAll(() => t.close());

  const create = (body: Record<string, unknown>) => user.post('/api-keys', { name: 'key', costCenterId: cc.id, ...body });
  const mockModels = async (id: string) => t.mock.keys.get(await t.litellmKeyIdOf(id))!.models;

  it('a provider selects all current models of that provider, combined with single models', async () => {
    const r = await create({ providers: ['anthropic'] });
    expect(r.status).toBe(201);
    const k = expectShape(CreatedApiKeySchema, r.body);
    expect(k).toMatchObject({ models: ['claude-opus-5', 'claude-sonnet-5'], providers: ['anthropic'] });
    expect(await mockModels(k.id)).toEqual(['claude-opus-5', 'claude-sonnet-5']);

    const both = expectShape(CreatedApiKeySchema, (await create({ models: ['gpt-4o', 'claude-opus-5'], providers: ['anthropic'] })).body);
    expect(both).toMatchObject({ models: ['gpt-4o', 'claude-opus-5', 'claude-sonnet-5'], providers: ['anthropic'] });
    expect(expectShape(paginated(ApiKeySchema), (await user.get('/api-keys')).body).items.find((x) => x.id === both.id)!.providers).toEqual(['anthropic']);
    // #10: models grouped by provider for the table popover
    expect(both.modelGroups).toEqual([
      { provider: 'anthropic', models: ['claude-opus-5', 'claude-sonnet-5'] },
      { provider: 'openai', models: ['gpt-4o'] },
    ]);
  });

  it('validates providers against the cost center', async () => {
    expectError(await create({ models: [], providers: [] }), 400, 'VALIDATION_ERROR');
    expectError(await create({}), 400, 'VALIDATION_ERROR');
    expectError(await create({ providers: ['does-not-exist'] }), 409, 'MODEL_NOT_ALLOWED');
    // only paid models -> not on the default cost center
    expectError(await create({ providers: ['anthropic'], costCenterId: defaultId }), 409, 'PAID_MODEL_REQUIRES_COST_CENTER');
    const free = await create({ providers: ['hosted_vllm'], costCenterId: defaultId });
    expect(free.status).toBe(201);
    expect(free.body.models).toEqual(['gemma-local']);
  });

  it('future models of the provider are added on provider sync; tier rules still apply', async () => {
    const anthropic = (await create({ name: 'anthropic', providers: ['anthropic'] })).body;
    const single = (await create({ name: 'single', models: ['claude-sonnet-5'] })).body;
    const local = (await create({ name: 'local', providers: ['hosted_vllm'], costCenterId: defaultId })).body;

    t.mock.models.push(
      { modelName: 'claude-haiku-5', modelId: 'm-claude-haiku', provider: 'anthropic', inputCostPerToken: null, outputCostPerToken: null },
      { modelName: 'qwen-local', modelId: 'm-qwen', provider: 'hosted_vllm', inputCostPerToken: null, outputCostPerToken: null },
    );
    expect((await admin.post('/admin/providers/sync')).status).toBe(200);

    expect(await mockModels(anthropic.id)).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5']);
    expect((await t.keyRow(anthropic.id)).models).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5']);
    expect(await mockModels(single.id)).toEqual(['claude-sonnet-5']);
    // new models arrive as paid (F-PRV-2): the default cost center key gets qwen-local only once it is free
    expect(await mockModels(local.id)).toEqual(['gemma-local']);
    const qwen = (await admin.get('/admin/providers')).body.find((p: { modelName: string }) => p.modelName === 'qwen-local');
    expect((await admin.patch(`/admin/providers/${qwen.id}`, { tier: 'free' })).status).toBe(200);
    expect(await mockModels(local.id)).toEqual(['gemma-local', 'qwen-local']);
    expect((await user.get('/api-keys')).body.items.find((x: { id: string }) => x.id === local.id).models).toEqual(['gemma-local', 'qwen-local']);

    // deleted keys are left alone
    expect((await user.delete(`/api-keys/${anthropic.id}`)).status).toBe(200);
    t.mock.models.push({ modelName: 'claude-mini-5', modelId: 'm-claude-mini', provider: 'anthropic', inputCostPerToken: null, outputCostPerToken: null });
    expect((await admin.post('/admin/providers/sync')).status).toBe(200);
    expect((await t.keyRow(anthropic.id)).models).not.toContain('claude-mini-5');
  });
});
