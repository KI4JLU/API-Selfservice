import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { costCenters, eq } from '@api-selfservice/db';
import { CostCenterLookupSchema, CostCenterOrLookupSchema, CostCenterRequestSchema, CostCenterSchema, MeSchema, paginated } from '@api-selfservice/shared';
import { addMember, createTestApp, expectError, expectShape, litellmOwner, randomCostCenter, syncProvidersWithFree, type Client, type TestApp } from './harness.js';

describe('profile + cost centers', () => {
  let t: TestApp;
  let admin: Client;
  let defaultId: string;
  let owner: { userId: string; email: string };

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    defaultId = (await admin.get('/me')).body.costCenter.id;
    owner = await litellmOwner(t);
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
      const lookup = expectShape(paginated(CostCenterLookupSchema), (await u.get('/cost-centers')).body);
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

    it('switching to an approved cost center needs a membership (F-KST-12)', async () => {
      const u = await t.login();
      const number = randomCostCenter();
      const created = await admin.post('/admin/cost-centers', { number, name: 'Approved', ownerUserId: owner.userId });
      expect(created.status).toBe(201);
      expectError(await u.patch('/me', { costCenterNumber: number }), 409, 'COST_CENTER_NOT_MEMBER');
      await addMember(admin, created.body.id, u);
      // adding made it the profile cost center; switch away and back
      expect((await u.patch('/me', { costCenterNumber: '11111111' })).body.costCenter.number).toBe('11111111');
      const r = await u.patch('/me', { costCenterNumber: number });
      expect(r.status).toBe(200);
      expect(r.body.requestCreated).toBeNull();
      expect(r.body.costCenter.number).toBe(number);
      // switching back to the default works as well
      expect((await u.patch('/me', { costCenterNumber: '11111111' })).body.costCenter.number).toBe('11111111');
    });
  });

  describe('requests: approve / reject', () => {
    it('admin approves -> cost center switches, owner becomes its admin, requester a member, all mailed', async () => {
      const u = await t.login();
      const number = randomCostCenter();
      const boss = await litellmOwner(t, 'boss@x.de', 'Boss');
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
      const cc = expectShape(CostCenterSchema, (await admin.get(`/cost-centers/${me.costCenter.id}`)).body);
      expect(cc.status).toBe('approved');
      // the requester is a plain member and only sees the lookup fields (F-KST-8)
      expect(expectShape(CostCenterLookupSchema, (await u.get(`/cost-centers/${cc.id}`)).body)).toEqual({ id: cc.id, number, name: cc.name, isDefault: false, status: 'approved' });
      expect(cc.approvedBy).toBe(admin.userId);
      // the owner is the cost center admin (F-KST-14), the requester a member (F-KST-10) ...
      expect(cc.ownerUserId).toBe(boss.userId);
      expect(me.effectiveRole).toBe('user');
      expect(me.managedCostCenters).toEqual([]);
      expect(me.memberCostCenters.map((c) => [c.id, c.role])).toEqual([
        [defaultId, 'user'],
        [cc.id, 'user'],
      ]);
      // ... mirrored into the LiteLLM team (E-8); the default team membership stays
      expect(t.mock.teams.get(cc.id)).toMatchObject({ alias: `${number} Kostenstelle ${number}`, blocked: false, maxBudget: null });
      expect(t.mock.teams.get(cc.id)?.members.get(boss.userId)).toBe('admin');
      expect(t.mock.teams.get(cc.id)?.members.get(u.userId)).toBe('user');
      expect(t.mock.teams.get(defaultId)?.members.get(u.userId)).toBe('user');
      expect(await t.notificationsOf('cost_center_member_added', 'boss@x.de')).toHaveLength(1);
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
      const prof = await litellmOwner(t, 'prof@x.de', 'Prof');
      const r = await admin.post('/admin/cost-centers', { number, name: 'Institut', ownerUserId: prof.userId, maxBudget: 100 });
      expect(r.status).toBe(201);
      const cc = expectShape(CostCenterSchema, r.body);
      expect(cc).toMatchObject({ number, status: 'approved', isDefault: false, maxBudget: 100, budgetPeriod: 'monthly', blocked: false, approvedBy: admin.userId, spendCurrentPeriod: 0 });
      // the owner comes from LiteLLM and is the cost center admin (F-KST-14)
      expect(cc).toMatchObject({ ownerUserId: prof.userId, ownerName: 'Prof', ownerEmail: 'prof@x.de' });
      expect((await admin.get(`/cost-centers/${cc.id}/members`)).body).toEqual([expect.objectContaining({ userId: prof.userId, role: 'admin', status: 'never_signed_in' })]);
      expect(t.mock.teams.get(cc.id)?.members.get(prof.userId)).toBe('admin');
      expectError(await admin.post('/admin/cost-centers', { number, name: 'Dup', ownerUserId: owner.userId }), 409, 'COST_CENTER_EXISTS');
      expectError(await admin.post('/admin/cost-centers', { number: '11111111', name: 'Dup', ownerUserId: owner.userId }), 409, 'COST_CENTER_EXISTS');
      // user requesting an already approved number -> COST_CENTER_EXISTS
      const u = await t.login();
      expectError(await u.post('/cost-centers', { number, name: 'n', ownerName: 'o', ownerEmail: 'o@x.de' }), 409, 'COST_CENTER_EXISTS');
    });

    it('validates input', async () => {
      expectError(await admin.post('/admin/cost-centers', { number: '1234', name: 'x', ownerUserId: owner.userId }), 400, 'VALIDATION_ERROR');
      expectError(await admin.post('/admin/cost-centers', { number: randomCostCenter(), name: 'x' }), 400, 'VALIDATION_ERROR');
      // F-KST-14: the owner must be a LiteLLM user
      expectError(await admin.post('/admin/cost-centers', { number: randomCostCenter(), name: 'x', ownerUserId: 'nobody-in-litellm' }), 409, 'OWNER_NOT_LITELLM_USER');
      const u = await t.login();
      expectError(await u.post('/cost-centers', { number: randomCostCenter(), name: 'n', ownerEmail: 'nobody@x.de' }), 409, 'OWNER_NOT_LITELLM_USER');
      expectError(await admin.post('/admin/cost-centers', { number: randomCostCenter(), name: 'x', ownerUserId: owner.userId, maxBudget: -1 }), 400, 'VALIDATION_ERROR');
    });

    it('PATCH updates name, owner and budget period; project period is stored', async () => {
      const number = randomCostCenter();
      const { id } = (await admin.post('/admin/cost-centers', { number, name: 'Old', ownerUserId: owner.userId })).body;
      const newOwner = await litellmOwner(t, undefined, 'New Owner');
      const r = await admin.patch(`/cost-centers/${id}`, {
        name: 'New',
        ownerUserId: newOwner.userId,
        maxBudget: 500,
        budgetPeriod: 'project',
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-12-31T00:00:00.000Z',
      });
      expect(r.status).toBe(200);
      const cc = expectShape(CostCenterSchema, r.body);
      expect(cc).toMatchObject({
        name: 'New',
        ownerName: 'New Owner',
        ownerEmail: newOwner.email,
        ownerUserId: newOwner.userId,
        maxBudget: 500,
        budgetPeriod: 'project',
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-12-31T00:00:00.000Z',
      });
      // the new owner becomes admin, the previous owner stays admin until demoted (F-KST-14)
      const roles = Object.fromEntries(((await admin.get(`/cost-centers/${id}/members`)).body as { userId: string; role: string }[]).map((m) => [m.userId, m.role]));
      expect(roles).toEqual({ [owner.userId]: 'admin', [newOwner.userId]: 'admin' });
      expectError(await admin.patch(`/cost-centers/${id}`, { ownerUserId: 'nobody-in-litellm' }), 409, 'OWNER_NOT_LITELLM_USER');
      // mirrored to the LiteLLM team: alias, budget; project budgets have no reset duration
      expect(t.mock.teams.get(id)).toMatchObject({ alias: `${number} New`, maxBudget: 500, budgetDuration: null });
      expectError(await admin.patch('/cost-centers/nope', { name: 'x' }), 404, 'NOT_FOUND');
    });

    it('budget, spend and owner of a cost center are only visible to admins and its own cost center admins (F-KST-8)', async () => {
      const ccAdmin = await t.login();
      const plain = await t.login();
      const mine = (await admin.post('/admin/cost-centers', { number: randomCostCenter(), name: 'Mine', ownerUserId: ccAdmin.userId, maxBudget: 100 })).body as { id: string };
      const other = (await admin.post('/admin/cost-centers', { number: randomCostCenter(), name: 'Other', ownerUserId: owner.userId, maxBudget: 200 })).body as { id: string };
      await addMember(ccAdmin, mine.id, plain);
      const sensitive = ['maxBudget', 'spendCurrentPeriod', 'ownerEmail', 'ownerName', 'ownerUserId', 'models', 'requestedBy', 'approvedBy'];

      for (const c of [plain, ccAdmin]) {
        const list = expectShape(paginated(CostCenterOrLookupSchema), (await c.get('/cost-centers?pageSize=200')).body);
        for (const cc of list.items.filter((x) => x.id !== mine.id || c === plain)) for (const f of sensitive) expect(cc, `${f} of ${cc.id}`).not.toHaveProperty(f);
        expect(Object.keys((await c.get(`/cost-centers/${other.id}`)).body).sort()).toEqual(['id', 'isDefault', 'name', 'number', 'status']);
      }
      expect(Object.keys((await plain.get(`/cost-centers/${mine.id}`)).body).sort()).toEqual(['id', 'isDefault', 'name', 'number', 'status']);
      // the cost center's own admin and global admins get everything
      expect(expectShape(CostCenterSchema, (await ccAdmin.get(`/cost-centers/${mine.id}`)).body).maxBudget).toBe(100);
      const mineInList = ((await ccAdmin.get('/cost-centers?pageSize=200')).body.items as { id: string }[]).find((x) => x.id === mine.id);
      expect(expectShape(CostCenterSchema, mineInList).maxBudget).toBe(100);
      expect(expectShape(CostCenterSchema, (await admin.get(`/cost-centers/${other.id}`)).body).maxBudget).toBe(200);
      const all = expectShape(paginated(CostCenterSchema), (await admin.get('/cost-centers?pageSize=200')).body);
      expect(all.items.find((x) => x.id === other.id)?.maxBudget).toBe(200);
    });

    it('released models narrow what a cost center and its LiteLLM team may use (F-KST-15)', async () => {
      await syncProvidersWithFree(admin);
      const ccAdmin = await t.login();
      const member = await t.login();
      const created = expectShape(
        CostCenterSchema,
        (await admin.post('/admin/cost-centers', { number: randomCostCenter(), name: 'Models', ownerUserId: ccAdmin.userId, models: ['gpt-4o', 'gpt-4o'] })).body,
      );
      expect(created.models).toEqual(['gpt-4o']);
      expect(t.mock.teams.get(created.id)?.models).toEqual(['gpt-4o']);
      await addMember(ccAdmin, created.id, member);

      // only released models are offered and accepted, also through a provider (F-KEY-10)
      const offered = (await member.get(`/providers?costCenterId=${created.id}`)).body as { modelName: string }[];
      expect(offered.map((p) => p.modelName)).toEqual(['gpt-4o']);
      expectError(await member.post('/api-keys', { name: 'k', models: ['claude-sonnet-5'], costCenterId: created.id }), 409, 'MODEL_NOT_ALLOWED');
      expectError(await member.post('/api-keys', { name: 'k', providers: ['anthropic'], costCenterId: created.id }), 409, 'MODEL_NOT_ALLOWED');
      const pk = await member.post('/api-keys', { name: 'openai', providers: ['openai'], costCenterId: created.id });
      expect(pk.body.models).toEqual(['gpt-4o']);

      // an empty release means all models; provider keys pick up the newly released ones
      const r = await admin.patch(`/cost-centers/${created.id}`, { models: [] });
      expect(expectShape(CostCenterSchema, r.body).models).toEqual([]);
      expect(t.mock.teams.get(created.id)?.models).toEqual([]);
      const key = ((await member.get('/api-keys')).body.items as { id: string; models: string[] }[]).find((k) => k.id === pk.body.id)!;
      expect(key.models.sort()).toEqual(['gpt-4o', 'gpt-4o-mini']);

      expectError(await admin.patch(`/cost-centers/${created.id}`, { models: ['no-such-model'] }), 409, 'MODEL_NOT_ALLOWED');
      // cost center admins may only change the budget
      expectError(await ccAdmin.patch(`/cost-centers/${created.id}`, { models: ['gpt-4o'] }), 403, 'FORBIDDEN');
    });

    it('default cost center satisfies the shared CostCenterSchema', async () => {
      // Flip this to `it(...)` once the seed / schema is fixed; the lenient schema in harness.ts can then be dropped.
      expectShape(CostCenterSchema, (await admin.get(`/cost-centers/${defaultId}`)).body);
    });

    it('default cost center is immutable and cannot be archived', async () => {
      expectError(await admin.patch(`/cost-centers/${defaultId}`, { name: 'Renamed' }), 409, 'COST_CENTER_DEFAULT_IMMUTABLE');
      expectError(await admin.patch(`/cost-centers/${defaultId}`, { ownerUserId: owner.userId }), 409, 'COST_CENTER_DEFAULT_IMMUTABLE');
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
      const { id } = (await admin.post('/admin/cost-centers', { number, name: 'Doomed', ownerUserId: owner.userId })).body;
      await addMember(admin, id, u);
      const deputy = await t.login();
      await addMember(admin, id, deputy, 'admin');
      expect((await u.get('/me')).body.costCenter.id).toBe(id);
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
      // the LiteLLM team is blocked; memberships stay for the record, the default team still has the user
      expect(t.mock.teams.get(id)?.blocked).toBe(true);
      expect(t.mock.teams.get(id)?.members.get(u.userId)).toBe('user');
      expect(t.mock.teams.get(defaultId)?.members.get(u.userId)).toBe('user');
      expect((await u.get('/me')).body.memberCostCenters.map((c: { id: string }) => c.id)).toEqual([defaultId]);
      // archived cost centers cannot be selected or requested; keys cannot be created on them
      expectError(await u.patch('/me', { costCenterNumber: number }), 409, 'COST_CENTER_NOT_APPROVED');
      expectError(await u.post('/cost-centers', { number, name: 'n', ownerName: 'o', ownerEmail: 'o@x.de' }), 409, 'COST_CENTER_NOT_APPROVED');
      expectError(await u.post('/api-keys', { name: 'k2', models: ['gemma-local'], costCenterId: id }), 409, 'COST_CENTER_NOT_APPROVED');
      // a former cost center admin cannot reopen it through its budget; budget checks skip archived cost centers
      expectError(await deputy.patch(`/cost-centers/${id}`, { maxBudget: 5000 }), 409, 'COST_CENTER_NOT_APPROVED');
      await t.db.update(costCenters).set({ blockedAt: new Date(), maxBudget: '1' }).where(eq(costCenters.id, id));
      await admin.patch(`/cost-centers/${id}`, { maxBudget: 1000 });
      expect((await t.keyRow(key.body.id)).status).toBe('blocked');
      expect(t.mock.teams.get(id)?.blocked).toBe(true);
      // not in the user lookup any more, but readable for admins
      expect((await u.get('/cost-centers')).body.items.find((c: { id: string }) => c.id === id)).toBeUndefined();
      expect((await admin.get(`/cost-centers/${id}`)).status).toBe(200);
      expectError(await u.get(`/cost-centers/${id}`), 403, 'FORBIDDEN');
    });

    it('lookup search by number (with spaces) and by name', async () => {
      const number = randomCostCenter();
      await admin.post('/admin/cost-centers', { number, name: 'Searchable Lab', ownerUserId: owner.userId });
      const u = await t.login();
      const byNumber = await u.get(`/cost-centers?q=${encodeURIComponent(`${number.slice(0, 4)} ${number.slice(4)}`)}`);
      expect(byNumber.body.items.map((c: { number: string }) => c.number)).toEqual([number]);
      const byName = await u.get('/cost-centers?q=Searchable');
      expect(byName.body.items.map((c: { number: string }) => c.number)).toEqual([number]);
      expect((await u.get('/cost-centers?q=zzzz-nothing')).body.total).toBe(0);
    });
  });
});
