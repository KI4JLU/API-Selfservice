import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditEventSchema, paginated } from '@api-selfservice/shared';
import { approvedCostCenterFor, createTestApp, expectError, expectShape, syncProvidersWithFree, type Client, type TestApp } from './harness.js';
import { runJob } from '../jobs/index.js';

type Event = (typeof AuditEventSchema)['_output'];

describe('admin event log', () => {
  let t: TestApp;
  let admin: Client;

  const events = async (query = '') => expectShape(paginated(AuditEventSchema), (await admin.get(`/admin/events${query}`)).body).items as Event[];
  const eventsOf = async (action: string, entityId: string) => events(`?action=${action}&entityId=${entityId}`);

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true, name: 'Root Admin' });
    await syncProvidersWithFree(admin);
  });
  afterAll(() => t.close());

  it('records new user, new key and new budget with actor and entity label', async () => {
    const u = await t.login({ name: 'Eve Example' });
    const cc = await approvedCostCenterFor(t, admin, u);
    const key = await u.post('/api-keys', { name: 'events-key', models: ['gpt-4o'], costCenterId: cc.id });
    expect(key.status).toBe(201);
    await admin.put(`/admin/users/${u.userId}/budget`, { amount: 10, period: 'monthly' });

    const [created] = await eventsOf('user.create', u.userId);
    expect(created).toMatchObject({ severity: 'info', entity: 'user', entityId: u.userId, entityLabel: u.email, actor: null, payload: { email: u.email, adoptedFromLitellm: false } });

    const [keyCreated] = await eventsOf('key.create', key.body.id);
    expect(keyCreated).toMatchObject({ severity: 'info', entity: 'api_key', entityLabel: 'events-key', actor: { id: u.userId, email: u.email, name: 'Eve Example' }, payload: { name: 'events-key', costCenter: cc.number } });

    const [budgetSet] = await eventsOf('budget.set', u.userId);
    expect(budgetSet).toMatchObject({ severity: 'info', entity: 'user', entityLabel: u.email, actor: { id: admin.userId }, payload: { amount: 10, period: 'monthly' } });

    const [ccCreated] = await eventsOf('cost_center.create', cc.id);
    expect(ccCreated).toMatchObject({ entity: 'cost_center', entityLabel: expect.stringContaining(cc.number), actor: { id: admin.userId } });

    // newest first, paginated
    const page = (await admin.get('/admin/events?pageSize=2')).body;
    expect(page.items).toHaveLength(2);
    expect(page.pageSize).toBe(2);
    expect(page.total).toBeGreaterThan(2);
    expect(new Date(page.items[0].createdAt) >= new Date(page.items[1].createdAt)).toBe(true);

    // filters
    expect((await events(`?entity=api_key&actorId=${u.userId}`)).every((e) => e.entity === 'api_key' && e.actor?.id === u.userId)).toBe(true);
    expect((await events(`?entity=api_key&actorId=${u.userId}`)).length).toBeGreaterThan(0);
    // createdAt is the DB clock (not the fake test clock)
    const inAMinute = new Date(Date.now() + 60_000).toISOString();
    expect((await events(`?from=${encodeURIComponent(inAMinute)}`)).length).toBe(0);
    expect((await events(`?to=${encodeURIComponent(inAMinute)}&action=user.create&entityId=${u.userId}`)).length).toBe(1);
    expect((await events(`?to=${encodeURIComponent('2000-01-01T00:00:00.000Z')}`)).length).toBe(0);
    expectError(await admin.get('/admin/events?severity=loud'), 400, 'VALIDATION_ERROR');
    expectError(await admin.get('/admin/events?entity=budget'), 400, 'VALIDATION_ERROR');
  });

  it('logs budget alerts (80 % warning, 100 % block) with severity warning', async () => {
    const u = await t.login();
    const cc = await approvedCostCenterFor(t, admin, u);
    const key = await u.post('/api-keys', { name: 'alert-key', models: ['gpt-4o'], costCenterId: cc.id });
    await admin.put(`/admin/users/${u.userId}/budget`, { amount: 10, period: 'monthly' });

    await t.addLog(key.body.id, { spend: 8.5, startTime: t.ago(3) });
    await t.ingest();
    expect(await eventsOf('budget.warn', u.userId)).toHaveLength(1);
    expect((await eventsOf('budget.warn', u.userId))[0]).toMatchObject({ severity: 'warning', actor: null, payload: { percent: 85 } });
    expect(await eventsOf('budget.block', u.userId)).toHaveLength(0);

    await t.addLog(key.body.id, { spend: 2, startTime: t.ago(1) });
    await t.ingest();
    const [block] = await eventsOf('budget.block', u.userId);
    expect(block).toMatchObject({ severity: 'warning', entity: 'user', entityLabel: u.email, payload: { percent: 105 } });
    expect((await events('?severity=warning')).every((e) => e.severity === 'warning')).toBe(true);
    expect((await events('?severity=warning')).length).toBeGreaterThanOrEqual(2);
  });

  it('logs LiteLLM sync failures as errors without failing the request', async () => {
    const u = await t.login();
    const orig = t.mock.updateUserBudget;
    t.mock.updateUserBudget = async () => {
      throw new Error('litellm down');
    };
    try {
      expect((await admin.put(`/admin/users/${u.userId}/budget`, { amount: 5, period: 'monthly' })).status).toBe(200);
    } finally {
      t.mock.updateUserBudget = orig;
    }
    const [err] = await eventsOf('litellm.update_user_budget', u.userId);
    expect(err).toMatchObject({ severity: 'error', entity: 'user', actor: { id: admin.userId }, payload: { error: { name: 'Error', message: 'litellm down' } } });
    expect(await eventsOf('budget.set', u.userId)).toHaveLength(1);
  });

  it('logs unhandled request errors and failed jobs as errors', async () => {
    const orig = t.mock.listUsers;
    t.mock.listUsers = async () => {
      throw new Error('boom');
    };
    let res;
    try {
      res = await admin.get('/admin/litellm-users?q=x', { headers: { 'x-request-id': 'req-events-1' } });
    } finally {
      t.mock.listUsers = orig;
    }
    expectError(res, 500, 'INTERNAL');
    const [reqErr] = await eventsOf('request.internal_error', 'req-events-1');
    expect(reqErr).toMatchObject({
      severity: 'error',
      entity: 'request',
      entityLabel: 'req-events-1',
      actor: { id: admin.userId },
      payload: { method: 'GET', path: '/api/v1/admin/litellm-users', error: { message: 'boom' } },
    });

    expect(await runJob(t.deps, 'unit-test-job', () => Promise.reject(new Error('job exploded')))).toBeNull();
    const [jobErr] = await eventsOf('job.failed', 'unit-test-job');
    expect(jobErr).toMatchObject({ severity: 'error', entity: 'job', entityLabel: 'unit-test-job', actor: null, payload: { error: { message: 'job exploded' } } });
    expect(await runJob(t.deps, 'unit-test-ok', async () => 42)).toBe(42);
    expect(await eventsOf('job.failed', 'unit-test-ok')).toHaveLength(0);
  });

  it('is admin-only', async () => {
    const u = await t.login();
    expectError(await u.get('/admin/events'), 403, 'FORBIDDEN');
    expectError(await t.anonymous().get('/admin/events'), 401, 'UNAUTHORIZED');
  });
});
