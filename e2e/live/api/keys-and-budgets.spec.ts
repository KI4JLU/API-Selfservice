import { expect, test } from '@playwright/test';
import { RUN } from '../env';
import { chatDirect, cleanup, created, getKey, keyExists, memberBudget } from '../litellm-admin';
import { expectError, json, liveUser, pickPricedModel, uniqueCostCenterNumber, type LiveUser } from '../support';

/**
 * #11 and #15 against a live LiteLLM proxy: key expiry, renewal and member budgets as LiteLLM stores and enforces them.
 * Serial: the blocks share one cost center.
 */

test.describe.configure({ mode: 'serial' });

const DAY = 86_400_000;
const TINY = 0.000001; // EUR; one real request exceeds it

let admin: LiveUser;
let owner: LiveUser;
let member: LiveUser;
let late: LiveUser;
let model: string;
let ccId: string;

type Key = { id: string; secret: string; expiresAt: string; models: string[] };

async function newKey(u: LiveUser, name: string, extra: Record<string, unknown> = {}): Promise<Key> {
  const key = await json<Key>(u.api.post('/api/v1/api-keys', { data: { name: `test ${RUN} ${name}`, models: [model], costCenterId: ccId, ...extra } }), 201);
  created.keys.add(key.secret);
  return key;
}

/** LiteLLM computes `expires` from the duration at its own clock; a minute of skew is fine. */
function expectSameTime(actual: string | null, expected: string) {
  expect(actual, 'LiteLLM expires').not.toBeNull();
  expect(Math.abs(new Date(actual!).getTime() - new Date(expected).getTime())).toBeLessThan(60_000);
}

test.beforeAll(async () => {
  admin = await liveUser('kb-admin', { admin: true });
  owner = await liveUser('kb-owner');
  member = await liveUser('kb-member');
  late = await liveUser('kb-late');
  model = await pickPricedModel(admin.api);
  const cc = await json<{ id: string }>(
    admin.api.post('/api/v1/admin/cost-centers', {
      data: { number: uniqueCostCenterNumber(), name: `test ${RUN} keys`, ownerUserId: owner.id, sapRecipient: { type: 'cost_center', number: '12345678' } },
    }),
    201,
  );
  ccId = cc.id;
  created.teams.add(ccId);
  await json(owner.api.post(`/api/v1/cost-centers/${ccId}/members`, { data: { userId: member.id, role: 'user' } }), 201);
});

test.afterAll(async () => {
  const errors = await cleanup();
  for (const u of [admin, owner, member, late]) await u?.api.dispose();
  expect(errors, 'LiteLLM cleanup').toEqual([]);
});

test.describe('#11 key expiry and renewal', () => {
  test('the chosen expiry is the LiteLLM expiry; more than 182 days is refused', async () => {
    const in30 = new Date(Date.now() + 30 * DAY).toISOString();
    const k = await newKey(member, 'expiry', { expiresAt: in30 });
    expectSameTime((await getKey(k.secret)).expires, k.expiresAt);
    await expectError(
      member.api.post('/api/v1/api-keys', { data: { name: `test ${RUN} too long`, models: [model], costCenterId: ccId, expiresAt: new Date(Date.now() + 200 * DAY).toISOString() } }),
      422,
      'KEY_EXPIRY_OUT_OF_RANGE',
    );
  });

  test('changing the expiry moves it in LiteLLM (shorter and back out to the limit)', async () => {
    const k = await newKey(member, 'change');
    const shorter = await json<Key>(member.api.patch(`/api/v1/api-keys/${k.id}`, { data: { expiresAt: new Date(Date.now() + 5 * DAY).toISOString() } }));
    expectSameTime((await getKey(k.secret)).expires, shorter.expiresAt);
    const longer = await json<Key & { maxExpiresAt: string }>(member.api.patch(`/api/v1/api-keys/${k.id}`, { data: { expiresAt: new Date(Date.now() + 181 * DAY).toISOString() } }));
    expectSameTime((await getKey(k.secret)).expires, longer.expiresAt);
    await expectError(member.api.patch(`/api/v1/api-keys/${k.id}`, { data: { expiresAt: new Date(Date.now() + 190 * DAY).toISOString() } }), 422, 'KEY_EXPIRY_OUT_OF_RANGE');
  });

  test('renewal: a new secret with the same models on the team; the old key keeps working until deleted', async () => {
    const old = await newKey(member, 'renew');
    const fresh = await json<Key>(member.api.post(`/api/v1/api-keys/${old.id}/renew`, { data: {} }), 201);
    created.keys.add(fresh.secret);
    expect(fresh.secret).not.toBe(old.secret);
    const info = await getKey(fresh.secret);
    expect(info).toMatchObject({ teamId: ccId, userId: member.id, blocked: false });
    expect(info.models).toEqual((await getKey(old.secret)).models);
    expectSameTime(info.expires, fresh.expiresAt);
    // both keys answer during the switch-over
    expect(await chatDirect(old.secret, model)).toBe(200);
    expect(await chatDirect(fresh.secret, model)).toBe(200);
    // renewing again with revokeOld removes the replaced key from LiteLLM
    const third = await json<Key>(member.api.post(`/api/v1/api-keys/${fresh.id}/renew`, { data: { revokeOld: true } }), 201);
    created.keys.add(third.secret);
    expect(await keyExists(fresh.secret)).toBe(false);
    expect(await chatDirect(third.secret, model)).toBe(200);
  });
});

test.describe('#15 member budgets', () => {
  test('member budget and individual budgets land on the LiteLLM team membership', async () => {
    const cc = await json<{ memberBudget: number; memberBudgetPeriod: string }>(
      owner.api.patch(`/api/v1/cost-centers/${ccId}`, { data: { memberBudget: 5, memberBudgetPeriod: 'monthly', memberBudgets: [{ userId: member.id, budget: 7 }] } }),
    );
    expect(cc).toMatchObject({ memberBudget: 5, memberBudgetPeriod: 'monthly' });
    expect(await memberBudget(ccId, member.id)).toEqual({ maxBudget: 7, budgetDuration: '30d' });
    expect(await memberBudget(ccId, owner.id)).toEqual({ maxBudget: 5, budgetDuration: '30d' });
  });

  test('new members get the member budget; resetting an individual budget falls back to it', async () => {
    await json(owner.api.post(`/api/v1/cost-centers/${ccId}/members`, { data: { userId: late.id, role: 'user' } }), 201);
    expect(await memberBudget(ccId, late.id)).toEqual({ maxBudget: 5, budgetDuration: '30d' });
    await json(owner.api.patch(`/api/v1/cost-centers/${ccId}`, { data: { memberBudgets: [{ userId: member.id, budget: null }] } }));
    expect(await memberBudget(ccId, member.id)).toEqual({ maxBudget: 5, budgetDuration: '30d' });
  });

  test('LiteLLM refuses requests once the member budget is used up', async () => {
    test.setTimeout(120_000);
    await json(owner.api.patch(`/api/v1/cost-centers/${ccId}`, { data: { memberBudgets: [{ userId: late.id, budget: TINY }] } }));
    const k = await newKey(late, 'member-budget');
    expect(await chatDirect(k.secret, model)).toBe(200);
    // LiteLLM writes spend in batches (proxy_batch_write_at); the member budget applies once it is booked
    await expect.poll(() => chatDirect(k.secret, model), { timeout: 90_000, intervals: [5_000] }).toBeGreaterThanOrEqual(400);
    // other members keep working
    const other = await newKey(member, 'other-member');
    expect(await chatDirect(other.secret, model)).toBe(200);
  });
});
