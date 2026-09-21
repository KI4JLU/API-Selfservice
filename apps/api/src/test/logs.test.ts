import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestLogSchema, paginated } from '@litelite/shared';
import { approvedCostCenterFor, createTestApp, expectError, expectShape, syncProvidersWithFree, type Client, type TestApp } from './harness.js';

describe('request logs', () => {
  let t: TestApp;
  let admin: Client;
  let a: Client;
  let b: Client;
  let kA1: string;
  let kA2: string;
  let kB: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    await syncProvidersWithFree(admin);
    a = await t.login();
    b = await t.login();
    const ccA = await approvedCostCenterFor(t, admin, a);
    const ccB = await approvedCostCenterFor(t, admin, b);
    kA1 = (await a.post('/api-keys', { name: 'a-one', models: ['gpt-4o', 'claude-sonnet-5'], costCenterId: ccA.id })).body.id;
    kA2 = (await a.post('/api-keys', { name: 'a-two', models: ['gpt-4o'], costCenterId: ccA.id })).body.id;
    kB = (await b.post('/api-keys', { name: 'b-one', models: ['gpt-4o'], costCenterId: ccB.id })).body.id;

    // 5 logs on kA1 (one failure), 2 on kA2, 3 on kB; distinct times, oldest first
    await t.addLog(kA1, { requestId: 'req-a1-1', model: 'gpt-4o', spend: 0.1, startTime: t.ago(9), sessionId: 'sess-1', tags: ['t1'] });
    await t.addLog(kA1, { requestId: 'req-a1-2', model: 'claude-sonnet-5', spend: 0.2, startTime: t.ago(8) });
    await t.addLog(kA1, { requestId: 'req-a1-3', model: 'gpt-4o', spend: 0.3, startTime: t.ago(7), status: 'failure', error: 'boom' });
    await t.addLog(kA1, { requestId: 'req-a1-4', model: 'claude-sonnet-5', spend: 0.4, startTime: t.ago(6) });
    await t.addLog(kA1, { requestId: 'req-a1-5', model: 'gpt-4o', spend: 0.5, startTime: t.ago(5), callType: 'aembedding', durationMs: 1234, ttftMs: 111, promptTokens: 7, completionTokens: 3 });
    await t.addLog(kA2, { requestId: 'req-a2-1', model: 'gpt-4o', spend: 1, startTime: t.ago(4) });
    await t.addLog(kA2, { requestId: 'req-a2-2', model: 'gpt-4o', spend: 1, startTime: t.ago(3) });
    await t.addLog(kB, { requestId: 'req-b-1', model: 'gpt-4o', spend: 1, startTime: t.ago(2) });
    await t.addLog(kB, { requestId: 'req-b-2', model: 'gpt-4o', spend: 1, startTime: t.ago(1.5) });
    await t.addLog(kB, { requestId: 'req-b-3', model: 'gpt-4o', spend: 1, startTime: t.ago(1) });
    await t.ingest();
  });
  afterAll(() => t.close());

  it('returns only own logs, newest first, with metadata only', async () => {
    const r = await a.get('/me/logs');
    expect(r.status).toBe(200);
    const page = expectShape(paginated(RequestLogSchema), r.body);
    expect(page.total).toBe(7);
    expect(page.items).toHaveLength(7);
    expect(page.items.map((l) => l.requestId)).toEqual(['req-a2-2', 'req-a2-1', 'req-a1-5', 'req-a1-4', 'req-a1-3', 'req-a1-2', 'req-a1-1']);
    const l = page.items.find((x) => x.requestId === 'req-a1-5')!;
    expect(l).toMatchObject({ type: 'aembedding', status: 'success', model: 'gpt-4o', keyId: kA1, keyName: 'a-one', cost: 0.5, durationMs: 1234, ttftMs: 111, tokensIn: 7, tokensOut: 3, error: null });
    expect(l.time).toBe(t.ago(5));
    const first = page.items.find((x) => x.requestId === 'req-a1-1')!;
    expect(first.sessionId).toBe('sess-1');
    expect(first.tags).toEqual(['t1']);
    const failed = page.items.find((x) => x.requestId === 'req-a1-3')!;
    expect(failed).toMatchObject({ status: 'failure', error: 'boom' });
    // no prompt/response content anywhere
    expect(JSON.stringify(r.body)).not.toMatch(/messages|prompt|response/i);
  });

  it('paginates server-side', async () => {
    const p1 = expectShape(paginated(RequestLogSchema), (await a.get('/me/logs?pageSize=3&page=1')).body);
    expect(p1).toMatchObject({ total: 7, page: 1, pageSize: 3 });
    expect(p1.items.map((l) => l.requestId)).toEqual(['req-a2-2', 'req-a2-1', 'req-a1-5']);
    const p3 = (await a.get('/me/logs?pageSize=3&page=3')).body;
    expect(p3.items.map((l: { requestId: string }) => l.requestId)).toEqual(['req-a1-1']);
    expect((await a.get('/me/logs?pageSize=3&page=4')).body.items).toEqual([]);
    expectError(await a.get('/me/logs?page=0'), 400, 'VALIDATION_ERROR');
    expectError(await a.get('/me/logs?pageSize=500'), 400, 'VALIDATION_ERROR');
  });

  it('filters by model, status, keyId, requestId and time range', async () => {
    const ids = (r: { body: { items: { requestId: string }[] } }) => r.body.items.map((l) => l.requestId);
    expect(ids(await a.get('/me/logs?model=claude-sonnet-5'))).toEqual(['req-a1-4', 'req-a1-2']);
    expect(ids(await a.get('/me/logs?status=failure'))).toEqual(['req-a1-3']);
    expect((await a.get('/me/logs?status=success')).body.total).toBe(6);
    expect(ids(await a.get(`/me/logs?keyId=${kA2}`))).toEqual(['req-a2-2', 'req-a2-1']);
    expect(ids(await a.get('/me/logs?requestId=req-a1-4'))).toEqual(['req-a1-4']);
    expect((await a.get('/me/logs?requestId=req-b-1')).body.total).toBe(0); // someone else's request id
    expect(ids(await a.get(`/me/logs?from=${encodeURIComponent(t.ago(7))}&to=${encodeURIComponent(t.ago(5))}`))).toEqual(['req-a1-5', 'req-a1-4', 'req-a1-3']);
    expect(ids(await a.get(`/me/logs?from=${encodeURIComponent(t.ago(3.5))}`))).toEqual(['req-a2-2']);
    expect(ids(await a.get(`/me/logs?to=${encodeURIComponent(t.ago(8.5))}`))).toEqual(['req-a1-1']);
    expect(ids(await a.get(`/me/logs?model=gpt-4o&status=success&keyId=${kA1}`))).toEqual(['req-a1-5', 'req-a1-1']);
    expectError(await a.get('/me/logs?from=2026-09-15'), 400, 'VALIDATION_ERROR');
    expectError(await a.get('/me/logs?status=pending'), 400, 'VALIDATION_ERROR');
  });

  it("other users never see A's logs; filtering by a foreign key id yields nothing", async () => {
    const r = expectShape(paginated(RequestLogSchema), (await b.get('/me/logs')).body);
    expect(r.total).toBe(3);
    expect(r.items.map((l) => l.requestId)).toEqual(['req-b-3', 'req-b-2', 'req-b-1']);
    expect((await b.get(`/me/logs?keyId=${kA1}`)).body.total).toBe(0);
  });

  it('admins see only their own logs (F-LOG-5)', async () => {
    expect((await admin.get('/me/logs')).body.total).toBe(0);
    const cc = await approvedCostCenterFor(t, admin, admin);
    const k = (await admin.post('/api-keys', { name: 'admin-key', models: ['gpt-4o'], costCenterId: cc.id })).body.id;
    await t.addLog(k, { requestId: 'req-admin-1', spend: 0.01, startTime: t.ago(0.5) });
    await t.ingest();
    const r = await admin.get('/me/logs');
    expect(r.body.total).toBe(1);
    expect(r.body.items[0].requestId).toBe('req-admin-1');
  });

  it('logs without a matching key are attributed to nobody', async () => {
    t.mock.addLog({ apiKey: 'unknown-hash', requestId: 'req-orphan', spend: 5, startTime: t.ago(0.2) });
    await t.ingest();
    for (const c of [a, b, admin]) expect((await c.get('/me/logs?requestId=req-orphan')).body.total).toBe(0);
  });
});
