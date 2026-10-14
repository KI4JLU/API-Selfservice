import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CostCenterEventsSchema } from '@api-selfservice/shared';
import { audit } from '../services/audit.js';
import { addMember, createTestApp, expectError, expectShape, randomCostCenter, syncProvidersWithFree, type Client, type TestApp } from './harness.js';

describe('cost center event log (#13)', () => {
  let t: TestApp;
  let admin: Client;
  let ccAdmin: Client;
  let member: Client;
  let joiner: Client;
  let cc: { id: string };
  let keyId: string;

  const events = async (c: Client, query = '') => {
    const r = await c.get(`/cost-centers/${cc.id}/events${query}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return expectShape(CostCenterEventsSchema, r.body);
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    await syncProvidersWithFree(admin);
    ccAdmin = await t.login({ name: 'Events Admin' });
    member = await t.login({ name: 'Events Member' });
    joiner = await t.login({ name: 'Events Joiner' });
    const r = await admin.post('/admin/cost-centers', { number: randomCostCenter(), name: 'Events', ownerUserId: ccAdmin.userId });
    cc = { id: r.body.id };
    await addMember(ccAdmin, cc.id, member);
    keyId = (await member.post('/api-keys', { name: 'events-key', models: ['gpt-4o'], costCenterId: cc.id })).body.id;
    const req = await joiner.post('/me/join-requests', { costCenterId: cc.id, message: 'project' });
    await ccAdmin.post(`/cost-centers/${cc.id}/join-requests/${req.body.id}/approve`);
    await ccAdmin.patch(`/cost-centers/${cc.id}`, { maxBudget: 100, budgetPeriod: 'monthly' });
    await audit(t.deps, { actorId: null, severity: 'warning', action: 'cost_center.warn', entity: 'cost_center', entityId: cc.id, payload: { threshold: 0.8 } });
    await audit(t.deps, { actorId: null, severity: 'error', action: 'litellm.update_team', entity: 'cost_center', entityId: cc.id, payload: {} });
  });
  afterAll(() => t.close());

  it('lists members, requests, keys, budget and limits of the cost center, newest first, with categories and subjects', async () => {
    const e = await events(ccAdmin);
    const actions = e.items.map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['cost_center.create', 'cost_center.member_add', 'key.create', 'cost_center.join_request', 'cost_center.join_approve', 'cost_center.update', 'cost_center.warn']));
    // technical LiteLLM errors stay in the admin log
    expect(actions).not.toContain('litellm.update_team');
    expect(e.items[0]!.action).toBe('cost_center.warn');
    const byAction = (a: string) => e.items.find((x) => x.action === a)!;
    expect(byAction('key.create')).toMatchObject({ category: 'keys', entityLabel: 'events-key', subject: { id: member.userId } });
    expect(byAction('cost_center.join_request')).toMatchObject({ category: 'requests', subject: { id: joiner.userId } });
    expect(byAction('cost_center.join_approve')).toMatchObject({ category: 'requests', subject: { id: joiner.userId }, actor: { id: ccAdmin.userId } });
    const added = e.items.filter((x) => x.action === 'cost_center.member_add');
    expect(added.find((x) => x.subject?.id === member.userId)).toMatchObject({ category: 'membership', actor: { id: ccAdmin.userId } });
    expect(byAction('cost_center.update').category).toBe('budget');
    expect(byAction('cost_center.warn')).toMatchObject({ category: 'limits', severity: 'warning', actor: null });
    expect(e.counts).toMatchObject({ all: e.total, warnings: 1, limits: 1, keys: 1 });
    expect(e.items.some((x) => x.entityId === keyId)).toBe(true);
  });

  it('filters by category, warnings, person or key and period', async () => {
    expect((await events(ccAdmin, '?category=requests')).items.every((x) => x.category === 'requests')).toBe(true);
    expect((await events(ccAdmin, '?warningsOnly=true')).items.map((x) => x.action)).toEqual(['cost_center.warn']);
    const byPerson = await events(ccAdmin, '?q=events%20joiner');
    expect(byPerson.items.length).toBeGreaterThan(0);
    expect(byPerson.items.every((x) => x.subject?.id === joiner.userId || x.actor?.id === joiner.userId)).toBe(true);
    expect((await events(ccAdmin, '?q=events-key')).items.map((x) => x.action)).toEqual(['key.create']);
    // audit rows carry the database time
    expect((await events(ccAdmin, `?from=${new Date(Date.now() + 86400000).toISOString()}`)).total).toBe(0);
    const paged = await events(ccAdmin, '?pageSize=2&page=2');
    expect(paged.items).toHaveLength(2);
  });

  it('only for admins and the cost center admins of this cost center', async () => {
    expect((await admin.get(`/cost-centers/${cc.id}/events`)).status).toBe(200);
    expectError(await member.get(`/cost-centers/${cc.id}/events`), 403, 'FORBIDDEN');
    const otherAdmin = await t.login();
    await admin.post('/admin/cost-centers', { number: randomCostCenter(), name: 'Other', ownerUserId: otherAdmin.userId });
    expectError(await otherAdmin.get(`/cost-centers/${cc.id}/events`), 403, 'FORBIDDEN');
  });
});
