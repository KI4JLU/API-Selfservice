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
    expectError(await user.post(`/api-keys/${k.id}/extend`), 404, 'NOT_FOUND');
    expect((await admin.get('/admin/api-keys')).body.items.find((x: { id: string }) => x.id === k.id)).toBeUndefined();
    expect((await admin.get('/admin/api-keys?status=deleted')).body.items.find((x: { id: string }) => x.id === k.id)).toBeDefined();
  });

  it('extend sets expiresAt to now + KEY_LIFETIME_DAYS and resets the expiry notifications', async () => {
    const k = (await create(user, { name: 'extend' })).body;
    await t.db.update(apiKeys).set({ notified14d: true, notified1d: true }).where(eq(apiKeys.id, k.id));
    t.clock.now = new Date(t.clock.now.getTime() + 10 * DAY);
    const r = await user.post(`/api-keys/${k.id}/extend`);
    expect(r.status).toBe(200);
    const v = expectShape(ApiKeySchema, r.body);
    expect(new Date(v.expiresAt).getTime()).toBe(t.clock.now.getTime() + 182 * DAY);
    expect(v.lastExtendedAt).toBe(t.clock.now.toISOString());
    expect(v.status).toBe('active');
    const row = await t.keyRow(k.id);
    expect(row.notified14d).toBe(false);
    expect(row.notified1d).toBe(false);
    expect(t.mock.keys.get(row.litellmKeyId)!.expires).toBe(v.expiresAt);
    t.clock.now = new Date(t.clock.now.getTime() - 10 * DAY);
  });

  it("another user's key -> FORBIDDEN, unknown key -> NOT_FOUND", async () => {
    const k = (await create(user, { name: 'mine' })).body;
    expectError(await other.patch(`/api-keys/${k.id}`, { name: 'stolen' }), 403, 'FORBIDDEN');
    expectError(await other.delete(`/api-keys/${k.id}`), 403, 'FORBIDDEN');
    expectError(await other.post(`/api-keys/${k.id}/extend`), 403, 'FORBIDDEN');
    expect((await other.get('/api-keys')).body.items.find((x: { id: string }) => x.id === k.id)).toBeUndefined();
    expectError(await other.patch('/api-keys/does-not-exist', { name: 'x' }), 404, 'NOT_FOUND');
    expectError(await other.delete('/api-keys/does-not-exist'), 404, 'NOT_FOUND');
    // a user cannot create a key on a cost center that is not theirs? (allowed by design: any approved cost center)
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
    expectError(await user.post(`/api-keys/${k.id}/extend`), 409, 'KEY_NOT_ACTIVE');
    expect((await admin.get('/admin/api-keys?status=blocked')).body.items.map((x: { id: string }) => x.id)).toContain(k.id);

    const u = await admin.post(`/admin/api-keys/${k.id}/block`, { blocked: false });
    expect(u.body.status).toBe('active');
    expect(t.mock.keys.get(await t.litellmKeyIdOf(k.id))!.blocked).toBe(false);
    expectError(await admin.post('/admin/api-keys/nope/block', { blocked: true }), 404, 'NOT_FOUND');
  });
});
