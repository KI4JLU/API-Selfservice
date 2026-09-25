import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CostCenterReportDetailSchema, CostCenterReportRowSchema } from '@api-selfservice/shared';
import { z } from 'zod';
import { createTestApp, DAY, expectError, expectShape, randomCostCenter, syncProvidersWithFree, type Client, type TestApp } from './harness.js';

describe('reports', () => {
  let t: TestApp;
  let admin: Client;
  let ccAdmin: Client;
  let u1: Client;
  let u2: Client;
  let u3: Client;
  let cc1: { id: string; number: string };
  let cc2: { id: string; number: string };
  let k1a: string;
  let k1b: string;
  let k2: string;
  let k3: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    await syncProvidersWithFree(admin);
    const mk = async (extra: Record<string, unknown> = {}) => {
      const number = randomCostCenter();
      const r = await admin.post('/admin/cost-centers', { number, name: `CC ${number}`, ownerName: 'Owner', ownerEmail: `o-${number}@x.de`, ...extra });
      return { id: r.body.id as string, number };
    };
    cc1 = await mk({ maxBudget: 100 });
    cc2 = await mk();
    ccAdmin = await t.login();
    await admin.put(`/admin/users/${ccAdmin.userId}/cost-center-admin`, { costCenterIds: [cc1.id] });
    u1 = await t.login();
    u2 = await t.login();
    u3 = await t.login();
    await u1.patch('/me', { costCenterNumber: cc1.number });
    await u2.patch('/me', { costCenterNumber: cc1.number });
    await u3.patch('/me', { costCenterNumber: cc2.number });
    k1a = (await u1.post('/api-keys', { name: 'u1-a', models: ['gpt-4o'], costCenterId: cc1.id })).body.id;
    k1b = (await u1.post('/api-keys', { name: 'u1-b', models: ['gpt-4o'], costCenterId: cc1.id })).body.id;
    k2 = (await u2.post('/api-keys', { name: 'u2', models: ['gpt-4o'], costCenterId: cc1.id })).body.id;
    k3 = (await u3.post('/api-keys', { name: 'u3', models: ['gpt-4o'], costCenterId: cc2.id })).body.id;

    await t.addLog(k1a, { spend: 10, startTime: t.ago(5) });
    await t.addLog(k1a, { spend: 5, startTime: t.ago(4) });
    await t.addLog(k1b, { spend: 1, startTime: t.ago(3) });
    await t.addLog(k2, { spend: 4, startTime: t.ago(2) });
    await t.addLog(k3, { spend: 7, startTime: t.ago(1) });
    // older logs outside the current month, stored directly
    await t.storeLogs([
      await t.addLog(k1a, { spend: 100, startTime: '2026-08-10T10:00:00.000Z' }),
      await t.addLog(k3, { spend: 50, startTime: '2026-08-20T10:00:00.000Z' }),
    ]);
    await t.ingest();
  });
  afterAll(() => t.close());

  it('admin sees a row per cost center (current period by default)', async () => {
    const r = await admin.get('/reports/cost-centers');
    expect(r.status).toBe(200);
    const rows = expectShape(z.array(CostCenterReportRowSchema), r.body);
    expect(rows.map((x) => x.costCenter.number)).toEqual(['11111111', cc1.number, cc2.number].sort());
    const r1 = rows.find((x) => x.costCenter.id === cc1.id)!;
    expect(r1).toEqual({
      costCenter: { id: cc1.id, number: cc1.number, name: `CC ${cc1.number}`, ownerName: 'Owner', ownerEmail: `o-${cc1.number}@x.de` },
      budget: 100,
      spend: 20,
      remaining: 80,
      utilization: 0.2,
      userCount: 2,
      keyCount: 3,
      requests: 4,
    });
    const r2 = rows.find((x) => x.costCenter.id === cc2.id)!;
    expect(r2).toMatchObject({ budget: null, spend: 7, remaining: null, utilization: null, userCount: 1, keyCount: 1, requests: 1 });
  });

  it('detail drills down to users and keys', async () => {
    const r = await admin.get(`/reports/cost-centers/${cc1.id}`);
    expect(r.status).toBe(200);
    const d = expectShape(CostCenterReportDetailSchema, r.body);
    expect(d.summary.spend).toBe(20);
    const byUser = Object.fromEntries(d.users.map((u) => [u.user.id, u]));
    expect(byUser[u1.userId]).toMatchObject({ user: { id: u1.userId, email: u1.email }, spend: 16, requests: 3 });
    expect(byUser[u1.userId]!.keys.sort((a, b) => a.keyName.localeCompare(b.keyName))).toEqual([
      { keyId: k1a, keyName: 'u1-a', spend: 15, requests: 2 },
      { keyId: k1b, keyName: 'u1-b', spend: 1, requests: 1 },
    ]);
    expect(byUser[u2.userId]).toMatchObject({ spend: 4, requests: 1, keys: [{ keyId: k2, keyName: 'u2', spend: 4, requests: 1 }] });
    expect(d.users).toHaveLength(2);
    expectError(await admin.get('/reports/cost-centers/nope'), 404, 'NOT_FOUND');
  });

  it('from/to range is applied (inclusive days)', async () => {
    const aug = expectShape(z.array(CostCenterReportRowSchema), (await admin.get('/reports/cost-centers?from=2026-08-01&to=2026-08-31')).body);
    expect(aug.find((x) => x.costCenter.id === cc1.id)).toMatchObject({ spend: 100, requests: 1, remaining: 0, utilization: 1 });
    expect(aug.find((x) => x.costCenter.id === cc2.id)).toMatchObject({ spend: 50, requests: 1 });
    const augDetail = expectShape(CostCenterReportDetailSchema, (await admin.get(`/reports/cost-centers/${cc1.id}?from=2026-08-10&to=2026-08-10`)).body);
    expect(augDetail.summary.spend).toBe(100);
    expect(augDetail.users).toHaveLength(1);
    const both = (await admin.get('/reports/cost-centers?from=2026-08-01&to=2026-09-30')).body;
    expect(both.find((x: { costCenter: { id: string } }) => x.costCenter.id === cc1.id).spend).toBe(120);
    const none = (await admin.get('/reports/cost-centers?from=2026-01-01&to=2026-01-31')).body;
    expect(none.every((x: { spend: number }) => x.spend === 0)).toBe(true);
    // open ended
    const since = (await admin.get('/reports/cost-centers?from=2026-09-01')).body;
    expect(since.find((x: { costCenter: { id: string } }) => x.costCenter.id === cc1.id).spend).toBe(20);
    expectError(await admin.get('/reports/cost-centers?from=2026-9-1'), 400, 'VALIDATION_ERROR');
  });

  it('cost center admin sees only the assigned cost centers', async () => {
    const rows = expectShape(z.array(CostCenterReportRowSchema), (await ccAdmin.get('/reports/cost-centers')).body);
    expect(rows.map((x) => x.costCenter.id)).toEqual([cc1.id]);
    expect((await ccAdmin.get(`/reports/cost-centers/${cc1.id}`)).status).toBe(200);
    expectError(await ccAdmin.get(`/reports/cost-centers/${cc2.id}`), 403, 'FORBIDDEN');
    // after the assignment is removed, nothing is visible any more
    await admin.put(`/admin/users/${ccAdmin.userId}/cost-center-admin`, { costCenterIds: [] });
    expectError(await ccAdmin.get('/reports/cost-centers'), 403, 'FORBIDDEN');
    expect((await ccAdmin.get('/me')).body.effectiveRole).toBe('user');
    await admin.put(`/admin/users/${ccAdmin.userId}/cost-center-admin`, { costCenterIds: [cc1.id, cc2.id] });
    expect((await ccAdmin.get('/reports/cost-centers')).body.map((x: { costCenter: { id: string } }) => x.costCenter.id).sort()).toEqual([cc1.id, cc2.id].sort());
  });

  it('plain users have no access', async () => {
    expectError(await u1.get('/reports/cost-centers'), 403, 'FORBIDDEN');
    expectError(await u1.get(`/reports/cost-centers/${cc1.id}`), 403, 'FORBIDDEN');
  });

  it('project period cost centers report their fixed period by default', async () => {
    const number = randomCostCenter();
    const start = new Date(t.clock.now.getTime() - 2 * DAY).toISOString();
    const end = new Date(t.clock.now.getTime() + 10 * DAY).toISOString();
    const cc = (await admin.post('/admin/cost-centers', { number, name: 'Project', ownerName: 'o', ownerEmail: 'o@x.de', maxBudget: 10, budgetPeriod: 'project', periodStart: start, periodEnd: end })).body;
    const u = await t.login();
    await u.patch('/me', { costCenterNumber: number });
    const k = (await u.post('/api-keys', { name: 'p', models: ['gpt-4o'], costCenterId: cc.id })).body.id;
    await t.addLog(k, { spend: 2, startTime: new Date(t.clock.now.getTime() - 4 * DAY).toISOString() }); // before the project
    await t.addLog(k, { spend: 3, startTime: t.ago(0.5) });
    await t.ingest();
    const row = (await admin.get('/reports/cost-centers')).body.find((x: { costCenter: { id: string } }) => x.costCenter.id === cc.id);
    expect(row).toMatchObject({ spend: 3, budget: 10, remaining: 7, utilization: 0.3, requests: 1 });
    expect((await admin.get(`/cost-centers/${cc.id}`)).body.spendCurrentPeriod).toBe(3);
  });
});
