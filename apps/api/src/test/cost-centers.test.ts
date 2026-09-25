import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CostCenterRequestSchema, CostCenterSchema, MeSchema, paginated } from '@api-selfservice/shared';
import { createTestApp, expectError, expectShape, randomCostCenter, syncProvidersWithFree, type Client, type TestApp } from './harness.js';

describe('profile + cost centers', () => {
  let t: TestApp;
  let admin: Client;
  let defaultId: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    defaultId = (await admin.get('/me')).body.costCenter.id;
  });
  afterAll(() => t.close());

  describe('PATCH /me', () => {
    it('updates locale and owner fields', async () => {
      const u = await t.login();
      const r = await u.patch('/me', { locale: 'en', costCenterOwnerName: 'Owner', costCenterOwnerEmail: 'owner@x.de' });
      expect(r.status).toBe(200);
      expect(r.body.requestCreated).toBeNull();
      const me = expectShape(MeSchema, (await u.get('/me')).body);
      expect(me.locale).toBe('en');
      expect(me.costCenterOwnerName).toBe('Owner');
      expect(me.costCenterOwnerEmail).toBe('owner@x.de');
    });

    it('unknown 8-digit number creates a pending request and keeps the old cost center', async () => {
      const u = await t.login();
      const number = randomCostCenter();
      const r = await u.patch('/me', { costCenterNumber: `${number.slice(0, 4)} ${number.slice(4)}` });
      expect(r.status).toBe(200);
      expect(r.body.requestCreated).toEqual({ number });
      expect(r.body.costCenter.number).toBe('11111111');
      expect(r.body.pendingRequest).toMatchObject({ number, status: 'pending', reason: null });
      // lookup shows only approved cost centers for users
      const lookup = expectShape(paginated(CostCenterSchema), (await u.get('/cost-centers')).body);
      expect(lookup.items.every((c) => c.status === 'approved')).toBe(true);
      expect(lookup.items.find((c) => c.number === number)).toBeUndefined();
      // admins see the pending one
      const pend = expectShape(paginated(CostCenterSchema), (await admin.get('/cost-centers?status=pending')).body);
      expect(pend.items.find((c) => c.number === number)?.requestedBy).toBe(u.userId);
      // admins were mailed
      expect((await t.notificationsOf('cost_center_request_created', admin.email)).length).toBeGreaterThan(0);
    });

    it('second request while one is pending -> COST_CENTER_REQUEST_PENDING', async () => {
      const u = await t.login();
      expect((await u.patch('/me', { costCenterNumber: randomCostCenter() })).status).toBe(200);
      expectError(await u.patch('/me', { costCenterNumber: randomCostCenter() }), 409, 'COST_CENTER_REQUEST_PENDING');
      expectError(await u.post('/cost-centers', { number: randomCostCenter(), name: 'n', ownerName: 'o', ownerEmail: 'o@x.de' }), 409, 'COST_CENTER_REQUEST_PENDING');
    });

    it('invalid numbers -> VALIDATION_ERROR', async () => {
      const u = await t.login();
      expectError(await u.patch('/me', { costCenterNumber: '1234abcd' }), 400, 'VALIDATION_ERROR');
      expectError(await u.patch('/me', { costCenterNumber: '1234' }), 400, 'VALIDATION_ERROR');
      expectError(await u.patch('/me', { costCenterNumber: '123456789' }), 400, 'VALIDATION_ERROR');
      expectError(await u.post('/cost-centers', { number: '12 34 56', name: 'n', ownerName: 'o', ownerEmail: 'o@x.de' }), 400, 'VALIDATION_ERROR');
    });

    it('selecting an approved cost center switches immediately', async () => {
      const u = await t.login();
      const number = randomCostCenter();
      expect((await admin.post('/admin/cost-centers', { number, name: 'Approved', ownerName: 'o', ownerEmail: 'o@x.de' })).status).toBe(201);
      const r = await u.patch('/me', { costCenterNumber: number });
      expect(r.status).toBe(200);
      expect(r.body.requestCreated).toBeNull();
      expect(r.body.costCenter.number).toBe(number);
      // switching back to the default works as well
      expect((await u.patch('/me', { costCenterNumber: '11111111' })).body.costCenter.number).toBe('11111111');
    });
  });

  describe('requests: approve / reject', () => {
    it('admin approves -> cost center switches, user and admins mailed', async () => {
      const u = await t.login();
      const number = randomCostCenter();
      await u.patch('/me', { costCenterNumber: number, costCenterOwnerName: 'Boss', costCenterOwnerEmail: 'boss@x.de' });
      const pending = expectShape(paginated(CostCenterRequestSchema), (await admin.get('/cost-center-requests?status=pending')).body);
      const req = pending.items.find((r) => r.user.id === u.userId)!;
      expect(req).toBeDefined();
      expect(req.costCenter).toMatchObject({ number, ownerName: 'Boss', ownerEmail: 'boss@x.de' });
      const a = await admin.post(`/cost-center-requests/${req.id}/approve`);
      expect(a.status).toBe(200);
      const approved = expectShape(CostCenterRequestSchema, a.body);
      expect(approved.status).toBe('approved');
      expect(approved.decidedBy).toBe(admin.userId);
      expect(approved.decidedAt).not.toBeNull();
      const me = expectShape(MeSchema, (await u.get('/me')).body);
      expect(me.costCenter.number).toBe(number);
      expect(me.pendingRequest?.status).toBe('approved');
      const cc = expectShape(CostCenterSchema, (await u.get(`/cost-centers/${me.costCenter.id}`)).body);
      expect(cc.status).toBe('approved');
      expect(cc.approvedBy).toBe(admin.userId);
      // mirrored as a LiteLLM team (E-8): user moved from the default team into the new one
      expect(t.mock.teams.get(cc.id)).toMatchObject({ alias: `${number} Kostenstelle ${number}`, blocked: false, maxBudget: null });
      expect(t.mock.teams.get(cc.id)?.members.get(u.userId)).toBe('user');
      expect(t.mock.teams.get(defaultId)?.members.has(u.userId)).toBe(false);
      expect(await t.notificationsOf('cost_center_request_approved', u.email)).toHaveLength(1);
      expect((await t.notificationsOf('cost_center_request_created', admin.email)).length).toBeGreaterThan(0);
      const mail = t.mailer.sent.find((m) => m.to === u.email && m.subject.includes('freigegeben'));
      expect(mail?.text).toContain(`${number.slice(0, 4)} ${number.slice(4)}`);
      // approving twice is a no-op
      expect((await admin.post(`/cost-center-requests/${req.id}/approve`)).body.status).toBe('approved');
    });

    it('admin rejects with reason -> status rejected + mail, user keeps default cost center', async () => {
      const u = await t.login();
      const number = randomCostCenter();
      await u.patch('/me', { costCenterNumber: number });
      const req = (await admin.get('/cost-center-requests?status=pending')).body.items.find((r: { user: { id: string } }) => r.user.id === u.userId);
      expectError(await admin.post(`/cost-center-requests/${req.id}/reject`, {}), 400, 'VALIDATION_ERROR');
      const r = await admin.post(`/cost-center-requests/${req.id}/reject`, { reason: 'Nicht plausibel' });
      expect(r.status).toBe(200);
      const rejected = expectShape(CostCenterRequestSchema, r.body);
      expect(rejected.status).toBe('rejected');
      expect(rejected.reason).toBe('Nicht plausibel');
      const me = expectShape(MeSchema, (await u.get('/me')).body);
      expect(me.costCenter.number).toBe('11111111');
      expect(me.pendingRequest).toMatchObject({ status: 'rejected', reason: 'Nicht plausibel' });
      const mails = await t.notificationsOf('cost_center_request_rejected', u.email);
      expect(mails).toHaveLength(1);
      expect(t.mailer.sent.find((m) => m.to === u.email && m.subject.includes('abgelehnt'))?.text).toContain('Nicht plausibel');
      // rejected cost center is not in the user lookup, but can be re-requested
      const lookup = await u.get('/cost-centers');
      expect(lookup.body.items.find((c: { number: string }) => c.number === number)).toBeUndefined();
      expect((await u.patch('/me', { costCenterNumber: number })).body.requestCreated).toEqual({ number });
    });

    it('unknown request -> NOT_FOUND', async () => {
      expectError(await admin.post('/cost-center-requests/nope/approve'), 404, 'NOT_FOUND');
      expectError(await admin.post('/cost-center-requests/nope/reject', { reason: 'x' }), 404, 'NOT_FOUND');
    });

    it('listing filters by status and paginates', async () => {
      const all = expectShape(paginated(CostCenterRequestSchema), (await admin.get('/cost-center-requests?pageSize=2')).body);
      expect(all.items.length).toBeLessThanOrEqual(2);
      expect(all.pageSize).toBe(2);
      expect(all.total).toBeGreaterThan(2);
      const rejected = await admin.get('/cost-center-requests?status=rejected');
      expect(rejected.body.items.every((r: { status: string }) => r.status === 'rejected')).toBe(true);
    });
  });

  describe('admin cost center management', () => {
    it('POST /admin/cost-centers creates an approved cost center; duplicates -> COST_CENTER_EXISTS', async () => {
      const number = randomCostCenter();
      const r = await admin.post('/admin/cost-centers', { number, name: 'Institut', ownerName: 'Prof', ownerEmail: 'prof@x.de', maxBudget: 100 });
      expect(r.status).toBe(201);
      const cc = expectShape(CostCenterSchema, r.body);
      expect(cc).toMatchObject({ number, status: 'approved', isDefault: false, maxBudget: 100, budgetPeriod: 'monthly', blocked: false, approvedBy: admin.userId, spendCurrentPeriod: 0 });
      expectError(await admin.post('/admin/cost-centers', { number, name: 'Dup', ownerName: 'o', ownerEmail: 'o@x.de' }), 409, 'COST_CENTER_EXISTS');
      expectError(await admin.post('/admin/cost-centers', { number: '11111111', name: 'Dup', ownerName: 'o', ownerEmail: 'o@x.de' }), 409, 'COST_CENTER_EXISTS');
      // user requesting an already approved number -> COST_CENTER_EXISTS
      const u = await t.login();
      expectError(await u.post('/cost-centers', { number, name: 'n', ownerName: 'o', ownerEmail: 'o@x.de' }), 409, 'COST_CENTER_EXISTS');
    });

    it('validates input', async () => {
      expectError(await admin.post('/admin/cost-centers', { number: '1234', name: 'x', ownerName: 'o', ownerEmail: 'o@x.de' }), 400, 'VALIDATION_ERROR');
      expectError(await admin.post('/admin/cost-centers', { number: randomCostCenter(), name: 'x', ownerName: 'o', ownerEmail: 'nope' }), 400, 'VALIDATION_ERROR');
      expectError(await admin.post('/admin/cost-centers', { number: randomCostCenter(), name: 'x', ownerName: 'o', ownerEmail: 'o@x.de', maxBudget: -1 }), 400, 'VALIDATION_ERROR');
    });

    it('PATCH updates name, owner and budget period; project period is stored', async () => {
      const number = randomCostCenter();
      const { id } = (await admin.post('/admin/cost-centers', { number, name: 'Old', ownerName: 'o', ownerEmail: 'o@x.de' })).body;
      const r = await admin.patch(`/cost-centers/${id}`, {
        name: 'New',
        ownerName: 'New Owner',
        maxBudget: 500,
        budgetPeriod: 'project',
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-12-31T00:00:00.000Z',
      });
      expect(r.status).toBe(200);
      const cc = expectShape(CostCenterSchema, r.body);
      expect(cc).toMatchObject({ name: 'New', ownerName: 'New Owner', maxBudget: 500, budgetPeriod: 'project', periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-12-31T00:00:00.000Z' });
      // mirrored to the LiteLLM team: alias, budget; project budgets have no reset duration
      expect(t.mock.teams.get(id)).toMatchObject({ alias: `${number} New`, maxBudget: 500, budgetDuration: null });
      expectError(await admin.patch('/cost-centers/nope', { name: 'x' }), 404, 'NOT_FOUND');
    });

    it('default cost center satisfies the shared CostCenterSchema', async () => {
      // Flip this to `it(...)` once the seed / schema is fixed; the lenient schema in harness.ts can then be dropped.
      expectShape(CostCenterSchema, (await admin.get(`/cost-centers/${defaultId}`)).body);
    });

    it('default cost center is immutable and cannot be archived', async () => {
      expectError(await admin.patch(`/cost-centers/${defaultId}`, { name: 'Renamed' }), 409, 'COST_CENTER_DEFAULT_IMMUTABLE');
      expectError(await admin.patch(`/cost-centers/${defaultId}`, { ownerEmail: 'x@y.de' }), 409, 'COST_CENTER_DEFAULT_IMMUTABLE');
      expectError(await admin.post(`/admin/cost-centers/${defaultId}/archive`), 409, 'COST_CENTER_DEFAULT_IMMUTABLE');
      const cc = expectShape(CostCenterSchema, (await admin.get(`/cost-centers/${defaultId}`)).body);
      expect(cc.isDefault).toBe(true);
      expect(cc.status).toBe('approved');
      expect(cc.number).toBe('11111111');
    });

    it('archive moves users back to the default cost center and blocks its keys', async () => {
      await syncProvidersWithFree(admin);
      const u = await t.login();
      const number = randomCostCenter();
      const { id } = (await admin.post('/admin/cost-centers', { number, name: 'Doomed', ownerName: 'o', ownerEmail: 'o@x.de' })).body;
      expect((await u.patch('/me', { costCenterNumber: number })).body.costCenter.id).toBe(id);
      const key = await u.post('/api-keys', { name: 'k', models: ['gpt-4o'], costCenterId: id });
      expect(key.status).toBe(201);

      const r = await admin.post(`/admin/cost-centers/${id}/archive`);
      expect(r.status).toBe(200);
      expect(expectShape(CostCenterSchema, r.body).status).toBe('archived');
      expect((await u.get('/me')).body.costCenter.number).toBe('11111111');
      const keys = (await u.get('/api-keys')).body.items;
      expect(keys[0].status).toBe('blocked');
      expect((await t.keyRow(key.body.id)).blockedReason).toBe('cost_center_archived');
      expect(t.mock.keys.get(await t.litellmKeyIdOf(key.body.id))?.blocked).toBe(true);
      // the LiteLLM team is blocked and the user moved back into the default team
      expect(t.mock.teams.get(id)?.blocked).toBe(true);
      expect(t.mock.teams.get(id)?.members.has(u.userId)).toBe(false);
      expect(t.mock.teams.get(defaultId)?.members.get(u.userId)).toBe('user');
      // archived cost centers cannot be selected or requested; keys cannot be created on them
      expectError(await u.patch('/me', { costCenterNumber: number }), 409, 'COST_CENTER_NOT_APPROVED');
      expectError(await u.post('/cost-centers', { number, name: 'n', ownerName: 'o', ownerEmail: 'o@x.de' }), 409, 'COST_CENTER_NOT_APPROVED');
      expectError(await u.post('/api-keys', { name: 'k2', models: ['gemma-local'], costCenterId: id }), 409, 'COST_CENTER_NOT_APPROVED');
      // not in the user lookup any more, but readable for admins
      expect((await u.get('/cost-centers')).body.items.find((c: { id: string }) => c.id === id)).toBeUndefined();
      expect((await admin.get(`/cost-centers/${id}`)).status).toBe(200);
      expectError(await u.get(`/cost-centers/${id}`), 403, 'FORBIDDEN');
    });

    it('lookup search by number (with spaces) and by name', async () => {
      const number = randomCostCenter();
      await admin.post('/admin/cost-centers', { number, name: 'Searchable Lab', ownerName: 'o', ownerEmail: 'o@x.de' });
      const u = await t.login();
      const byNumber = await u.get(`/cost-centers?q=${encodeURIComponent(`${number.slice(0, 4)} ${number.slice(4)}`)}`);
      expect(byNumber.body.items.map((c: { number: string }) => c.number)).toEqual([number]);
      const byName = await u.get('/cost-centers?q=Searchable');
      expect(byName.body.items.map((c: { number: string }) => c.number)).toEqual([number]);
      expect((await u.get('/cost-centers?q=zzzz-nothing')).body.total).toBe(0);
    });
  });
});
