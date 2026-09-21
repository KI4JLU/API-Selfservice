import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LitellmUserSchema, paginated } from '@litelite/shared';
import { createTestApp, expectError, expectShape, uniqEmail, type Client, type TestApp } from './harness.js';

describe('admin: LiteLLM user lookup', () => {
  let t: TestApp;
  let admin: Client;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true, name: 'Root Admin' });
  });
  afterAll(() => t.close());

  it('lists LiteLLM users with the matching LiteLite account, searches by e-mail substring and by id', async () => {
    const email = uniqEmail('lookup');
    const u = await t.login({ email, name: 'Lookup Person' });
    // A user that only exists in LiteLLM (never signed in to LiteLite).
    await t.mock.createUser({ userId: 'll-only-1', email: 'only-in-litellm@test.local', alias: 'Only LiteLLM' });

    const all = expectShape(paginated(LitellmUserSchema), (await admin.get('/admin/litellm-users')).body);
    expect(all.total).toBeGreaterThanOrEqual(3);
    expect(all.items.find((x) => x.userId === u.userId)).toMatchObject({ email, alias: 'Lookup Person', litelite: { id: u.userId, name: 'Lookup Person', status: 'active' } });
    expect(all.items.find((x) => x.userId === 'll-only-1')).toMatchObject({ email: 'only-in-litellm@test.local', litelite: null });

    const byEmail = (await admin.get(`/admin/litellm-users?q=${encodeURIComponent(email.slice(0, 10).toUpperCase())}`)).body;
    expect(byEmail.items.map((x: { userId: string }) => x.userId)).toEqual([u.userId]);
    const byId = (await admin.get(`/admin/litellm-users?q=${u.userId}`)).body;
    expect(byId.items.map((x: { userId: string }) => x.userId)).toEqual([u.userId]);
    expect((await admin.get('/admin/litellm-users?q=zzz-nobody')).body.total).toBe(0);

    await admin.post(`/admin/users/${u.userId}/deactivate`);
    expect((await admin.get(`/admin/litellm-users?q=${u.userId}`)).body.items[0].litelite.status).toBe('deactivated');

    const p = (await admin.get('/admin/litellm-users?pageSize=1&page=2')).body;
    expect(p.items).toHaveLength(1);
    expect(p.page).toBe(2);
  });

  it('is admin only', async () => {
    const user = await t.login();
    expectError(await user.get('/admin/litellm-users'), 403, 'FORBIDDEN');
  });
});
