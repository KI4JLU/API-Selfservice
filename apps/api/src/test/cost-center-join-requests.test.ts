import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CostCenterJoinRequestSchema, MeSchema } from '@api-selfservice/shared';
import { addMember, createTestApp, expectError, expectShape, randomCostCenter, type Client, type TestApp } from './harness.js';

describe('cost center join requests (F-KST-16)', () => {
  let t: TestApp;
  let admin: Client;
  let owner: Client;
  let ccAdmin: Client;
  let cc: { id: string; number: string };
  let defaultId: string;

  const newCostCenter = async (ownerUserId: string) => {
    const number = randomCostCenter();
    const r = await admin.post('/admin/cost-centers', { number, name: `CC ${number}`, ownerUserId });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return { id: r.body.id as string, number };
  };
  const requestJoin = (c: Client, costCenterId = cc.id, message?: string) => c.post('/me/join-requests', { costCenterId, message });

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true, name: 'Root Admin' });
    defaultId = (await admin.get('/me')).body.costCenter.id;
    owner = await t.login({ name: 'Owner' });
    cc = await newCostCenter(owner.userId);
    ccAdmin = await t.login({ name: 'Second Admin' });
    await addMember(owner, cc.id, ccAdmin, 'admin');
  });
  afterAll(() => t.close());

  it('a user asks to join; owner and cost center admins are mailed', async () => {
    const u = await t.login({ name: 'Joiner' });
    const r = await requestJoin(u, cc.id, '  Projekt KI-Lehre  ');
    expect(r.status).toBe(201);
    expect(expectShape(CostCenterJoinRequestSchema, r.body)).toMatchObject({
      user: { id: u.userId, name: 'Joiner', email: u.email },
      costCenter: { id: cc.id, number: cc.number },
      message: 'Projekt KI-Lehre',
      status: 'pending',
      reason: null,
      decidedBy: null,
    });
    expect(await t.notificationsOf('cost_center_join_request_created', owner.email)).toHaveLength(1);
    expect(await t.notificationsOf('cost_center_join_request_created', ccAdmin.email)).toHaveLength(1);
    expect(expectShape(z.array(CostCenterJoinRequestSchema), (await u.get('/me/join-requests')).body).map((j) => j.id)).toEqual([r.body.id]);
    // a second request while one is open
    expectError(await requestJoin(u), 409, 'COST_CENTER_JOIN_REQUEST_PENDING');
  });

  it('a cost center admin approves: the requester becomes a member and can book keys on it', async () => {
    const u = await t.login({ name: 'Approved Joiner' });
    const req = (await requestJoin(u)).body;
    const list = expectShape(z.array(CostCenterJoinRequestSchema), (await ccAdmin.get(`/cost-centers/${cc.id}/join-requests?status=pending`)).body);
    expect(list.map((j) => j.id)).toContain(req.id);

    const r = await ccAdmin.post(`/cost-centers/${cc.id}/join-requests/${req.id}/approve`);
    expect(r.status).toBe(200);
    expect(expectShape(CostCenterJoinRequestSchema, r.body)).toMatchObject({ status: 'approved', decidedBy: ccAdmin.userId });
    const me = expectShape(MeSchema, (await u.get('/me')).body);
    expect(me.memberCostCenters.map((c) => [c.id, c.role])).toEqual([
      [defaultId, 'user'],
      [cc.id, 'user'],
    ]);
    expect(t.mock.teams.get(cc.id)?.members.get(u.userId)).toBe('user');
    expect(await t.notificationsOf('cost_center_member_added', u.email)).toHaveLength(1);
    // approving twice changes nothing; a member cannot ask again
    expect((await ccAdmin.post(`/cost-centers/${cc.id}/join-requests/${req.id}/approve`)).body.status).toBe('approved');
    expectError(await requestJoin(u), 409, 'COST_CENTER_MEMBER_EXISTS');
  });

  it('rejecting needs a reason, mails the requester and allows a new request', async () => {
    const u = await t.login({ name: 'Rejected Joiner' });
    const req = (await requestJoin(u)).body;
    expectError(await owner.post(`/cost-centers/${cc.id}/join-requests/${req.id}/reject`, {}), 400, 'VALIDATION_ERROR');
    const r = await owner.post(`/cost-centers/${cc.id}/join-requests/${req.id}/reject`, { reason: 'Nicht im Projekt' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'rejected', reason: 'Nicht im Projekt', decidedBy: owner.userId });
    expect(await t.notificationsOf('cost_center_join_request_rejected', u.email)).toHaveLength(1);
    expect((await u.get('/me')).body.memberCostCenters.map((c: { id: string }) => c.id)).toEqual([defaultId]);
    expect((await requestJoin(u)).status).toBe(201);
  });

  it('only approved, non-default cost centers can be joined', async () => {
    const u = await t.login();
    expectError(await requestJoin(u, defaultId), 409, 'COST_CENTER_DEFAULT_IMMUTABLE');
    const archived = await newCostCenter(owner.userId);
    await admin.post(`/admin/cost-centers/${archived.id}/archive`);
    expectError(await requestJoin(u, archived.id), 409, 'COST_CENTER_NOT_APPROVED');
    expectError(await requestJoin(u, 'does-not-exist'), 404, 'NOT_FOUND');
  });

  it('only admins and the cost center admins of that cost center see and decide requests', async () => {
    const u = await t.login();
    const req = (await requestJoin(u)).body;
    const other = await t.login();
    const otherCc = await newCostCenter(other.userId);
    expect(otherCc.id).not.toBe(cc.id);
    // plain users and admins of other cost centers
    expectError(await u.get(`/cost-centers/${cc.id}/join-requests`), 403, 'FORBIDDEN');
    expectError(await other.get(`/cost-centers/${cc.id}/join-requests`), 403, 'FORBIDDEN');
    expectError(await other.post(`/cost-centers/${cc.id}/join-requests/${req.id}/approve`), 403, 'FORBIDDEN');
    // a request id from another cost center is not found under this one
    expectError(await other.post(`/cost-centers/${otherCc.id}/join-requests/${req.id}/approve`), 404, 'NOT_FOUND');
    // global admins decide everywhere
    expect((await admin.post(`/cost-centers/${cc.id}/join-requests/${req.id}/approve`)).body.status).toBe('approved');
  });

  it('GET /cost-center-join-requests lists the open requests of the managed cost centers only', async () => {
    const u = await t.login();
    const req = (await requestJoin(u)).body;
    const other = await t.login();
    const otherCc = await newCostCenter(other.userId);
    const otherReq = (await requestJoin(u, otherCc.id)).body;
    const ids = async (c: Client) => expectShape(z.array(CostCenterJoinRequestSchema), (await c.get('/cost-center-join-requests')).body).map((j) => j.id);

    expect(await ids(ccAdmin)).toContain(req.id);
    expect(await ids(ccAdmin)).not.toContain(otherReq.id);
    expect(await ids(other)).toEqual([otherReq.id]);
    expect(await ids(admin)).toEqual(expect.arrayContaining([req.id, otherReq.id]));
    expectError(await u.get('/cost-center-join-requests'), 403, 'FORBIDDEN');
    // decided requests drop out
    await other.post(`/cost-centers/${otherCc.id}/join-requests/${otherReq.id}/reject`, { reason: 'Nein' });
    expect(await ids(other)).toEqual([]);
  });
});
