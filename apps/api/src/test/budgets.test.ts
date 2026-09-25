import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminBudgetRowSchema, BudgetSchema, CostCenterSchema, SpendSummarySchema, paginated } from '@api-selfservice/shared';
import { approvedCostCenterFor, createTestApp, DAY, expectError, expectShape, randomCostCenter, syncProvidersWithFree, type Client, type TestApp } from './harness.js';

describe('budgets & spend', () => {
  let t: TestApp;
  let admin: Client;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    await syncProvidersWithFree(admin);
  });
  afterAll(() => t.close());

  async function userWithKey(models = ['gpt-4o']) {
    const u = await t.login();
    const cc = await approvedCostCenterFor(t, admin, u);
    const k = (await u.post('/api-keys', { name: 'main', models, costCenterId: cc.id })).body as { id: string };
    return { u, cc, k };
  }

  it('admin PUT budget is returned, visible to the user and synced to LiteLLM', async () => {
    const { u } = await userWithKey();
    expect((await u.get('/me/budget')).body).toBeNull();
    const r = await admin.put(`/admin/users/${u.userId}/budget`, { amount: 10, period: 'monthly' });
    expect(r.status).toBe(200);
    const b = expectShape(BudgetSchema, r.body);
    expect(b).toMatchObject({ amount: 10, period: 'monthly', periodStart: null, periodEnd: null, assignedBy: admin.userId });
    expect(t.mock.users.get(u.userId)?.maxBudget).toBe(10);
    expect(expectShape(BudgetSchema, (await u.get('/me/budget')).body).amount).toBe(10);
    // replace
    expect((await admin.put(`/admin/users/${u.userId}/budget`, { amount: 20, period: 'yearly' })).body).toMatchObject({ amount: 20, period: 'yearly' });
    expect(t.mock.users.get(u.userId)?.maxBudget).toBe(20);
    expectError(await admin.put(`/admin/users/${u.userId}/budget`, { amount: 5, period: 'weekly' }), 400, 'VALIDATION_ERROR');
    expectError(await admin.put(`/admin/users/${u.userId}/budget`, { amount: -5, period: 'monthly' }), 400, 'VALIDATION_ERROR');
    expectError(await admin.put('/admin/users/nope/budget', { amount: 5, period: 'monthly' }), 404, 'NOT_FOUND');
  });

  it('ingest maps logs to the user and /me/spend reports spend, metrics, daily, byModel, byKey, history', async () => {
    const { u, k } = await userWithKey(['gpt-4o', 'claude-sonnet-5']);
    await admin.put(`/admin/users/${u.userId}/budget`, { amount: 10, period: 'monthly' });
    await t.addLog(k.id, { spend: 1, model: 'gpt-4o', startTime: t.ago(3), promptTokens: 100, completionTokens: 50 });
    await t.addLog(k.id, { spend: 2, model: 'claude-sonnet-5', startTime: t.ago(2), promptTokens: 10, completionTokens: 20 });
    await t.addLog(k.id, { spend: 0.5, model: 'gpt-4o', startTime: t.ago(1), status: 'failure', error: 'rate limited', promptTokens: 1, completionTokens: 0 });
    // yesterday (still in the month and the ingest window)
    await t.addLog(k.id, { spend: 0.25, model: 'gpt-4o', startTime: new Date(t.clock.now.getTime() - DAY).toISOString(), promptTokens: 4, completionTokens: 4 });
    // a log for another user's key must not count for this user
    const o = await userWithKey();
    await t.addLog(o.k.id, { spend: 100, startTime: t.ago(1) });

    const r = await admin.post('/admin/jobs/ingest');
    expect(r.status).toBe(200);
    expect(r.body.inserted).toBeGreaterThanOrEqual(5);

    const s = expectShape(SpendSummarySchema, (await u.get('/me/spend')).body);
    expect(s.month).toBe('2026-09');
    expect(s.periodStart).toBe('2026-09-01T00:00:00.000Z');
    expect(s.periodEnd).toBe('2026-10-01T00:00:00.000Z');
    expect(s.spend).toBeCloseTo(3.75, 6);
    expect(s.budget?.amount).toBe(10);
    expect(s.remaining).toBeCloseTo(6.25, 6);
    expect(s.utilization).toBeCloseTo(0.375, 6);
    expect(s.blocked).toBe(false);
    expect(s.metrics).toEqual({ totalRequests: 4, successfulRequests: 3, failedRequests: 1, avgCostPerRequest: 3.75 / 4, totalTokens: 189, tokensIn: 115, tokensOut: 74 });
    expect(s.daily).toEqual([
      { date: '2026-09-14', spend: 0.25, requests: 1 },
      { date: '2026-09-15', spend: 3.5, requests: 3 },
    ]);
    expect(s.byModel).toEqual([
      { model: 'claude-sonnet-5', spend: 2, requests: 1, tokens: 30 },
      { model: 'gpt-4o', spend: 1.75, requests: 3, tokens: 159 },
    ]);
    expect(s.byProvider).toEqual([
      { provider: 'anthropic', spend: 2, requests: 1, tokens: 30 },
      { provider: 'openai', spend: 1.75, requests: 3, tokens: 159 },
    ]);
    expect(s.byKey).toEqual([{ keyId: k.id, keyName: 'main', spend: 3.75, requests: 4 }]);
    expect(s.history).toHaveLength(12);
    expect(s.history[11]).toEqual({ month: '2026-09', spend: 3.75 });
    expect(s.history[0]!.month).toBe('2025-10');
    expect(s.history.slice(0, 11).every((h) => h.spend === 0)).toBe(true);
    // key spend is visible in the key list
    expect((await u.get('/api-keys')).body.items[0].spend).toBe(3.75);
    // the other user only sees their own spend
    expect((await o.u.get('/me/spend')).body.spend).toBe(100);
  });

  it('a chosen month reports that month only; history covers older months stored directly', async () => {
    const { u, k } = await userWithKey();
    const old = await t.addLog(k.id, { spend: 7, startTime: '2026-07-10T08:00:00.000Z' });
    await t.storeLogs([old]);
    await t.addLog(k.id, { spend: 1 });
    await t.ingest();
    const now = expectShape(SpendSummarySchema, (await u.get('/me/spend')).body);
    expect(now.spend).toBe(1);
    expect(now.history.find((h) => h.month === '2026-07')?.spend).toBe(7);
    const july = expectShape(SpendSummarySchema, (await u.get('/me/spend?month=2026-07')).body);
    expect(july.month).toBe('2026-07');
    expect(july.spend).toBe(7);
    expect(july.daily).toEqual([{ date: '2026-07-10', spend: 7, requests: 1 }]);
    expectError(await u.get('/me/spend?month=2026-7'), 400, 'VALIDATION_ERROR');
  });

  it('ingest is idempotent: the same logs twice are not counted twice', async () => {
    const { u, k } = await userWithKey();
    await t.addLog(k.id, { spend: 3, startTime: t.ago(2) });
    const first = await t.ingest();
    expect(first.inserted).toBeGreaterThanOrEqual(1);
    // the 10 minute overlap re-fetches the log, request_id dedupes
    const second = await t.ingest();
    expect(second.fetched).toBeGreaterThanOrEqual(1);
    expect(second.inserted).toBe(0);
    expect((await u.get('/me/spend')).body.spend).toBe(3);
    expect((await u.get('/me/spend')).body.metrics.totalRequests).toBe(1);
    // explicit duplicate insert via storeLogs is ignored as well
    const litellmKeyId = await t.litellmKeyIdOf(k.id);
    const dup = t.mock.logs.find((l) => l.spend === 3 && l.apiKey === litellmKeyId)!;
    expect(await t.storeLogs([dup])).toBe(0);
  });

  it('warns once at >= 80 %, blocks at 100 %, unblocks when the budget is raised', async () => {
    const { u, k } = await userWithKey();
    await admin.put(`/admin/users/${u.userId}/budget`, { amount: 10, period: 'monthly' });
    const litellmKeyId = await t.litellmKeyIdOf(k.id);

    await t.addLog(k.id, { spend: 8.5, startTime: t.ago(3) });
    await t.ingest();
    expect(await t.notificationsOf('user_budget_80', u.email)).toHaveLength(1);
    expect(await t.notificationsOf('user_budget_100', u.email)).toHaveLength(0);
    const warn = t.mailer.sent.find((m) => m.to === u.email && /85 %/.test(m.subject));
    expect(warn?.text).toContain('8.50');
    expect((await u.get('/me/spend')).body.blocked).toBe(false);
    expect((await u.get('/api-keys')).body.items[0].status).toBe('active');
    // second ingest does not warn again
    await t.addLog(k.id, { spend: 0.5, startTime: t.ago(2) });
    await t.ingest();
    expect(await t.notificationsOf('user_budget_80', u.email)).toHaveLength(1);

    // 100 %
    await t.addLog(k.id, { spend: 1.5, startTime: t.ago(1) });
    await t.ingest();
    expect((await u.get('/me/spend')).body).toMatchObject({ spend: 10.5, remaining: 0, utilization: 1.05, blocked: true });
    expect((await u.get('/api-keys')).body.items[0].status).toBe('blocked');
    expect((await t.keyRow(k.id)).blockedReason).toBe('user_budget');
    expect(t.mock.keys.get(litellmKeyId)!.blocked).toBe(true);
    expect(await t.notificationsOf('user_budget_100', u.email)).toHaveLength(1);
    expectError(await u.post('/api-keys', { name: 'no', models: ['gpt-4o'], costCenterId: (await u.get('/me')).body.costCenter.id }), 409, 'KEY_NOT_ACTIVE');
    await t.ingest();
    expect(await t.notificationsOf('user_budget_100', u.email)).toHaveLength(1);
    const adminRow = (await admin.get('/admin/budgets')).body.items.find((r: { user: { id: string } }) => r.user.id === u.userId);
    expect(adminRow).toMatchObject({ spend: 10.5, blocked: true, utilization: 1.05 });

    // raise budget -> unblock
    expect((await admin.put(`/admin/users/${u.userId}/budget`, { amount: 30, period: 'monthly' })).status).toBe(200);
    expect((await u.get('/me/spend')).body).toMatchObject({ spend: 10.5, remaining: 19.5, blocked: false });
    expect((await u.get('/api-keys')).body.items[0].status).toBe('active');
    expect((await t.keyRow(k.id)).blockedReason).toBeNull();
    expect(t.mock.keys.get(litellmKeyId)!.blocked).toBe(false);
    expect(t.mock.users.get(u.userId)?.maxBudget).toBe(30);
    // an admin-blocked key is not unblocked by budget changes
    await admin.post(`/admin/api-keys/${k.id}/block`, { blocked: true });
    await admin.put(`/admin/users/${u.userId}/budget`, { amount: 40, period: 'monthly' });
    expect((await u.get('/api-keys')).body.items[0].status).toBe('blocked');
  });

  it('GET /admin/budgets lists users with budget, spend and utilization, filterable by cost center and month', async () => {
    const { u, k, cc } = await userWithKey();
    await admin.put(`/admin/users/${u.userId}/budget`, { amount: 50, period: 'monthly' });
    await t.addLog(k.id, { spend: 5 });
    await t.ingest();
    const rows = expectShape(paginated(AdminBudgetRowSchema), (await admin.get(`/admin/budgets?costCenterId=${cc.id}`)).body);
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]).toMatchObject({ user: { id: u.userId, email: u.email }, costCenter: { id: cc.id, number: cc.number }, budget: { amount: 50 }, spend: 5, utilization: 0.1, blocked: false });
    const all = expectShape(paginated(AdminBudgetRowSchema), (await admin.get('/admin/budgets')).body);
    expect(all.total).toBeGreaterThan(1);
    const aug = await admin.get(`/admin/budgets?costCenterId=${cc.id}&month=2026-08`);
    expect(aug.body.items[0].spend).toBe(0);
    expectError(await admin.get('/admin/budgets?month=nope'), 400, 'VALIDATION_ERROR');
  });

  describe('cost center max budget', () => {
    it('blocks all keys of the cost center at 100 %, mails owner + cost center admins, unblocks when raised', async () => {
      const number = randomCostCenter();
      const ownerEmail = `owner-${number}@x.de`;
      const created = await admin.post('/admin/cost-centers', { number, name: 'Capped', ownerName: 'Owner', ownerEmail, maxBudget: 5 });
      expect(created.status).toBe(201);
      const ccId = created.body.id as string;
      const ccAdmin = await t.login();
      await admin.put(`/admin/users/${ccAdmin.userId}/cost-center-admin`, { costCenterIds: [ccId] });
      const u1 = await t.login();
      const u2 = await t.login();
      await u1.patch('/me', { costCenterNumber: number });
      await u2.patch('/me', { costCenterNumber: number });
      const k1 = (await u1.post('/api-keys', { name: 'k1', models: ['gpt-4o'], costCenterId: ccId })).body;
      const k2 = (await u2.post('/api-keys', { name: 'k2', models: ['gpt-4o'], costCenterId: ccId })).body;
      const unrelated = await userWithKey();

      await t.addLog(k1.id, { spend: 3, startTime: t.ago(3) });
      await t.addLog(k2.id, { spend: 3, startTime: t.ago(2) });
      await t.ingest();

      const cc = expectShape(CostCenterSchema, (await admin.get(`/cost-centers/${ccId}`)).body);
      expect(cc.spendCurrentPeriod).toBe(6);
      expect(cc.blocked).toBe(true);
      for (const k of [k1, k2]) {
        expect((await t.keyRow(k.id)).status).toBe('blocked');
        expect((await t.keyRow(k.id)).blockedReason).toBe('cost_center_budget');
        expect(t.mock.keys.get(await t.litellmKeyIdOf(k.id))!.blocked).toBe(true);
      }
      expect((await t.keyRow(unrelated.k.id)).status).toBe('active');
      expect(await t.notificationsOf('cost_center_budget_100', ownerEmail)).toHaveLength(1);
      expect(await t.notificationsOf('cost_center_budget_100', ccAdmin.email)).toHaveLength(1);
      expect(await t.notificationsOf('cost_center_budget_100', u1.email)).toHaveLength(0);
      const mail = t.mailer.sent.find((m) => m.to === ownerEmail);
      expect(mail?.text).toContain(`${number.slice(0, 4)} ${number.slice(4)}`);
      // keys cannot be created on a blocked cost center
      expectError(await u1.post('/api-keys', { name: 'k3', models: ['gpt-4o'], costCenterId: ccId }), 409, 'KEY_NOT_ACTIVE');
      // repeated ingest does not re-notify
      await t.ingest();
      expect(await t.notificationsOf('cost_center_budget_100', ownerEmail)).toHaveLength(1);

      // cost center admin raises the budget to 7 (6/7 = 86 %): unblocked + single 80 % warning
      const raised = await ccAdmin.patch(`/cost-centers/${ccId}`, { maxBudget: 7 });
      expect(raised.status).toBe(200);
      expect(raised.body.blocked).toBe(false);
      for (const k of [k1, k2]) {
        expect((await t.keyRow(k.id)).status).toBe('active');
        expect(t.mock.keys.get(await t.litellmKeyIdOf(k.id))!.blocked).toBe(false);
      }
      expect(await t.notificationsOf('cost_center_budget_80', ownerEmail)).toHaveLength(1);
      expect(await t.notificationsOf('cost_center_budget_80', ccAdmin.email)).toHaveLength(1);
      await t.ingest();
      expect(await t.notificationsOf('cost_center_budget_80', ownerEmail)).toHaveLength(1);
      // report row reflects the budget
      const row = (await ccAdmin.get('/reports/cost-centers')).body.find((r: { costCenter: { id: string } }) => r.costCenter.id === ccId);
      expect(row).toMatchObject({ budget: 7, spend: 6, remaining: 1, keyCount: 2, userCount: 2, requests: 2 });
      // removing the budget clears any block
      await t.addLog(k1.id, { spend: 5, startTime: t.ago(1) });
      await t.ingest();
      expect((await admin.get(`/cost-centers/${ccId}`)).body.blocked).toBe(true);
      expect((await admin.patch(`/cost-centers/${ccId}`, { maxBudget: null })).body.blocked).toBe(false);
      expect((await t.keyRow(k1.id)).status).toBe('active');
    });
  });

  it('project period budgets count only logs inside the period', async () => {
    const { u, k } = await userWithKey();
    const periodStart = new Date(t.clock.now.getTime() - 3 * DAY).toISOString();
    const periodEnd = new Date(t.clock.now.getTime() + 30 * DAY).toISOString();
    const r = await admin.put(`/admin/users/${u.userId}/budget`, { amount: 10, period: 'project', periodStart, periodEnd });
    expect(r.status).toBe(200);
    expect(expectShape(BudgetSchema, r.body)).toMatchObject({ period: 'project', periodStart, periodEnd });
    // older logs are outside the incremental ingest window by now: store them directly
    await t.storeLogs([
      await t.addLog(k.id, { spend: 4, startTime: new Date(t.clock.now.getTime() - 5 * DAY).toISOString() }), // outside (before the project)
      await t.addLog(k.id, { spend: 3, startTime: new Date(t.clock.now.getTime() - 2 * DAY).toISOString() }), // inside
    ]);
    await t.addLog(k.id, { spend: 2, startTime: t.ago(1) }); // inside
    await t.ingest();
    const s = expectShape(SpendSummarySchema, (await u.get('/me/spend')).body);
    expect(s.periodStart).toBe(periodStart);
    expect(s.periodEnd).toBe(periodEnd);
    expect(s.spend).toBe(5);
    expect(s.remaining).toBe(5);
    expect(s.utilization).toBe(0.5);
    expect(s.metrics.totalRequests).toBe(2);
    expect(s.blocked).toBe(false);
    // the monthly view still shows everything of the month
    expect((await u.get('/me/spend?month=2026-09')).body.spend).toBe(9);
    // spend before the project start never blocks; spend inside does
    await t.addLog(k.id, { spend: 6, startTime: t.ago(0.5) });
    await t.ingest();
    expect((await u.get('/me/spend')).body).toMatchObject({ spend: 11, blocked: true });
    expect((await t.keyRow(k.id)).status).toBe('blocked');
  });
});
