import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { account, eq, user as userTable } from '@api-selfservice/db';
import { runAffiliationCheck, runDeletionReminder, runKeyExpiry } from '../jobs/index.js';
import { syncIdpClaims } from '../services/users.js';
import { approvedCostCenterFor, BASE_NOW, createTestApp, DAY, expectError, syncProvidersWithFree, uniqEmail, type Client, type TestApp } from './harness.js';

describe('jobs', () => {
  let t: TestApp;
  let admin: Client;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    await syncProvidersWithFree(admin);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    t.clock.now = new Date(BASE_NOW);
  });

  const at = (days: number) => new Date(BASE_NOW.getTime() + days * DAY);

  async function userWithKey(name = 'k') {
    const u = await t.login();
    const cc = await approvedCostCenterFor(t, admin, u);
    const k = (await u.post('/api-keys', { name, models: ['gpt-4o'], costCenterId: cc.id })).body as { id: string; expiresAt: string };
    return { u, cc, k, litellmKeyId: await t.litellmKeyIdOf(k.id) };
  }

  describe('runKeyExpiry', () => {
    it('warns once at 14d and 1d, expires and blocks at the expiry date; extend reactivates', async () => {
      const { u, k, litellmKeyId } = await userWithKey('expiring');
      expect(new Date(k.expiresAt).getTime()).toBe(at(182).getTime());

      // far away: nothing
      t.clock.now = at(100);
      expect(await runKeyExpiry(t.deps)).toEqual({ warned: 0, expired: 0 });
      expect(await t.notificationsOf('key_expires_14d', u.email)).toHaveLength(0);

      // 13 days before expiry: 14d warning, once
      t.clock.now = at(169);
      expect(await runKeyExpiry(t.deps)).toEqual({ warned: 1, expired: 0 });
      expect(await t.notificationsOf('key_expires_14d', u.email)).toHaveLength(1);
      const mail = t.mailer.sent.find((m) => m.to === u.email && m.subject.includes('14 Tagen'));
      expect(mail?.text).toContain('expiring');
      expect(mail?.text).toContain(k.expiresAt.slice(0, 10));
      expect(await runKeyExpiry(t.deps)).toEqual({ warned: 0, expired: 0 });
      expect(await t.notificationsOf('key_expires_14d', u.email)).toHaveLength(1);
      expect((await t.keyRow(k.id)).notified14d).toBe(true);
      expect((await t.keyRow(k.id)).status).toBe('active');

      // half a day before expiry: 1d warning, once
      t.clock.now = at(181.5);
      expect(await runKeyExpiry(t.deps)).toEqual({ warned: 1, expired: 0 });
      expect(await t.notificationsOf('key_expires_1d', u.email)).toHaveLength(1);
      expect(await runKeyExpiry(t.deps)).toEqual({ warned: 0, expired: 0 });
      expect(await t.notificationsOf('key_expires_1d', u.email)).toHaveLength(1);
      expect(t.mock.keys.get(litellmKeyId)!.blocked).toBe(false);

      // expiry: blocked in LiteLLM, status expired, mail
      t.clock.now = at(183);
      const r = await admin.post('/admin/jobs/key-expiry');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ warned: 0, expired: 1 });
      const row = await t.keyRow(k.id);
      expect(row.status).toBe('expired');
      expect(row.blockedReason).toBe('expired');
      expect(t.mock.keys.get(litellmKeyId)!.blocked).toBe(true);
      expect(await t.notificationsOf('key_expired', u.email)).toHaveLength(1);
      expect((await u.get('/api-keys')).body.items[0].status).toBe('expired');
      // a second run does nothing more
      expect(await runKeyExpiry(t.deps)).toEqual({ warned: 0, expired: 0 });
      expect(await t.notificationsOf('key_expired', u.email)).toHaveLength(1);

      // extend after expiry reactivates for another lifetime from now (F-KEY-5a)
      const ext = await u.post(`/api-keys/${k.id}/extend`);
      expect(ext.status).toBe(200);
      expect(ext.body.status).toBe('active');
      expect(new Date(ext.body.expiresAt).getTime()).toBe(at(183 + 182).getTime());
      expect(ext.body.lastExtendedAt).toBe(at(183).toISOString());
      expect(t.mock.keys.get(litellmKeyId)!.blocked).toBe(false);
      const ext2 = await t.keyRow(k.id);
      expect(ext2.notified14d).toBe(false);
      expect(ext2.notified1d).toBe(false);
      expect(ext2.blockedReason).toBeNull();
      // and the cycle starts again
      t.clock.now = at(183 + 170);
      expect(await runKeyExpiry(t.deps)).toEqual({ warned: 1, expired: 0 });
      expect(await t.notificationsOf('key_expires_14d', u.email)).toHaveLength(2);
    });

    it('a key that jumps straight past the 1d threshold gets only the 1d warning; blocked keys are ignored', async () => {
      const { u, k } = await userWithKey('late');
      const { k: blocked } = await userWithKey('blocked');
      await admin.post(`/admin/api-keys/${blocked.id}/block`, { blocked: true });
      t.clock.now = at(181.9);
      expect(await runKeyExpiry(t.deps)).toEqual({ warned: 1, expired: 0 });
      expect(await t.notificationsOf('key_expires_1d', u.email)).toHaveLength(1);
      expect(await t.notificationsOf('key_expires_14d', u.email)).toHaveLength(0);
      expect((await t.keyRow(k.id)).notified14d).toBe(true);
      t.clock.now = at(200);
      expect(await runKeyExpiry(t.deps)).toEqual({ warned: 0, expired: 1 });
      expect((await t.keyRow(blocked.id)).status).toBe('blocked');
    });
  });

  describe('runDeletionReminder', () => {
    it('mails admins once per user deactivated longer than DELETION_GRACE_DAYS', async () => {
      const victim = await t.login({ name: 'Gone' });
      const recent = await t.login({ name: 'Recent' });
      await admin.post(`/admin/users/${victim.userId}/deactivate`);
      t.clock.now = at(200);
      await admin.post(`/admin/users/${recent.userId}/deactivate`);

      expect(await runDeletionReminder(t.deps)).toEqual({ due: 0, sent: 0 });
      t.clock.now = at(366);
      expect(await runDeletionReminder(t.deps)).toEqual({ due: 1, sent: 1 });
      const mails = await t.notificationsOf('deletion_due', admin.email);
      expect(mails).toHaveLength(1);
      const mail = t.mailer.sent.find((m) => m.to === admin.email && m.subject.startsWith('Löschfrist'));
      expect(mail?.subject).toContain(victim.email);
      expect(mail?.text).toContain(BASE_NOW.toISOString().slice(0, 10));
      // no mail to the deactivated user, only once for admins
      expect(await t.notificationsOf('deletion_due', victim.email)).toHaveLength(0);
      expect(await runDeletionReminder(t.deps)).toEqual({ due: 1, sent: 0 });
      // the second one becomes due later
      t.clock.now = at(200 + 366);
      expect(await runDeletionReminder(t.deps)).toEqual({ due: 2, sent: 1 });
      expect(await t.notificationsOf('deletion_due', admin.email)).toHaveLength(2);
      // reactivated users are no longer due
      await admin.post(`/admin/users/${victim.userId}/reactivate`);
      expect(await runDeletionReminder(t.deps)).toEqual({ due: 1, sent: 0 });
    });
  });

  describe('runAffiliationCheck', () => {
    it('deactivates users whose captured affiliation is invalid, once', async () => {
      const { u, k, litellmKeyId } = await userWithKey();
      const fine = await t.login();
      await t.db.update(userTable).set({ affiliationValid: false, affiliation: ['alumni'] }).where(eq(userTable.id, u.userId));
      expectError(await u.get('/me'), 403, 'ACCOUNT_INVALID_AFFILIATION');

      // without Keycloak admin credentials the captured claims are used
      expect(await runAffiliationCheck(t.deps, null)).toMatchObject({ deactivated: 1, aborted: false });
      const view = (await admin.get(`/admin/users/${u.userId}`)).body;
      expect(view).toMatchObject({ status: 'deactivated', deletedReason: 'affiliation' });
      expect((await t.keyRow(k.id)).status).toBe('blocked');
      expect((await t.keyRow(k.id)).blockedReason).toBe('affiliation_invalid');
      expect(t.mock.keys.get(litellmKeyId)!.blocked).toBe(true);
      expect(t.mock.users.get(u.userId)!.blocked).toBe(true);
      expect(await t.notificationsOf('account_invalid_deactivated', u.email)).toHaveLength(1);
      expect(await t.notificationsOf('account_invalid_deactivated', admin.email)).toHaveLength(1);
      expect((await fine.get('/me')).status).toBe(200);
      // already deactivated users are not processed again
      expect(await runAffiliationCheck(t.deps, null)).toMatchObject({ deactivated: 0, aborted: false });
      expect(await t.notificationsOf('account_invalid_deactivated', u.email)).toHaveLength(1);
    });

    it('is a no-op when KEYCLOAK_AFFILIATION_VALID is empty', async () => {
      const deps = { ...t.deps, env: { ...t.deps.env, KEYCLOAK_AFFILIATION_VALID: [] } };
      const u = await t.login();
      await t.db.update(userTable).set({ affiliationValid: false }).where(eq(userTable.id, u.userId));
      expect(await runAffiliationCheck(deps, null)).toEqual({ checked: 0, deactivated: 0, aborted: false });
      expect((await admin.get(`/admin/users/${u.userId}`)).body.status).toBe('active');
      await t.db.update(userTable).set({ affiliationValid: true }).where(eq(userTable.id, u.userId));
    });

    it('with a Keycloak admin client every active user with a subject is re-checked; errors abort without deactivating', async () => {
      const mk = async (sub: string | null) => {
        const c = await t.login();
        // the Keycloak subject lives in the Better Auth account row (no user column any more)
        if (sub) await t.db.insert(account).values({ accountId: sub, providerId: 'keycloak', userId: c.userId });
        return c;
      };
      const run = uniqEmail('kc').slice(3, 11);
      const valid = await mk(`valid-${run}`);
      const disabled = await mk(`disabled-${run}`);
      const gone = await mk(`gone-${run}`);
      const alumni = await mk(`alumni-${run}`);
      const noSub = await mk(null);
      const fake = {
        async getUser(sub: string) {
          if (sub === `valid-${run}`) return { enabled: true, groups: ['LiteLLMAdmin'], affiliation: ['staff'] };
          if (sub === `disabled-${run}`) return { enabled: false, groups: [], affiliation: ['member'] };
          if (sub === `alumni-${run}`) return { enabled: true, groups: [], affiliation: ['alumni'] };
          if (sub === `gone-${run}`) return null;
          return { enabled: true, groups: [], affiliation: ['member'] };
        },
      };
      const res = await runAffiliationCheck(t.deps, fake);
      expect(res.aborted).toBe(false);
      expect(res.deactivated).toBeGreaterThanOrEqual(3);
      expect(res.checked).toBeGreaterThanOrEqual(4);
      const status = async (c: Client) => (await admin.get(`/admin/users/${c.userId}`)).body as { status: string; deletedReason: string | null; role: string; roleFromIdp: boolean };
      expect(await status(valid)).toMatchObject({ status: 'active', role: 'admin', roleFromIdp: true });
      expect(await status(disabled)).toMatchObject({ status: 'deactivated', deletedReason: 'affiliation' });
      expect(await status(gone)).toMatchObject({ status: 'deactivated', deletedReason: 'affiliation' });
      expect(await status(alumni)).toMatchObject({ status: 'deactivated', deletedReason: 'affiliation' });
      expect(await status(noSub)).toMatchObject({ status: 'active' });
      // the check does not count as a login
      const row = (await t.db.query.user.findFirst({ where: eq(userTable.id, valid.userId) }))!;
      expect(row.lastLoginAt?.getTime()).toBeLessThan(t.clock.now.getTime() + 1);
      expect(row.affiliation).toEqual(['staff']);

      // Keycloak outage: abort, nobody deactivated (O-7)
      const failing = {
        async getUser() {
          throw new Error('503');
        },
      };
      const before = (await admin.get('/admin/users?pageSize=200')).body.total;
      expect(await runAffiliationCheck(t.deps, failing)).toEqual({ checked: 0, deactivated: 0, aborted: true });
      expect((await admin.get('/admin/users?pageSize=200')).body.total).toBe(before);
      expect(await status(valid)).toMatchObject({ status: 'active' });
    });
  });

  describe('syncIdpClaims', () => {
    const claims = (o: Partial<{ sub: string | null; affiliation: string[]; isAdmin: boolean; affiliationValid: boolean }>) => ({
      sub: 'kc-sub',
      affiliation: ['member'],
      isAdmin: false,
      affiliationValid: true,
      ...o,
    });

    it('promotes on admin group membership and demotes when it disappears; manual admins stay', async () => {
      const u = await t.login();
      await syncIdpClaims(t.deps, u.userId, claims({ isAdmin: true }));
      let row = (await t.db.query.user.findFirst({ where: eq(userTable.id, u.userId) }))!;
      expect(row).toMatchObject({ role: 'admin', roleFromIdp: true, affiliation: ['member'], affiliationValid: true });
      expect(t.mock.users.get(u.userId)?.ssoUserId).toBe('kc-sub');
      expect(row.lastLoginAt?.toISOString()).toBe(t.clock.now.toISOString());
      expect((await u.get('/me')).body.role).toBe('admin');

      await syncIdpClaims(t.deps, u.userId, claims({ isAdmin: false, sub: null }));
      row = (await t.db.query.user.findFirst({ where: eq(userTable.id, u.userId) }))!;
      expect(row).toMatchObject({ role: 'user', roleFromIdp: false });

      // an admin granted in the portal is not touched by the IdP
      await admin.patch(`/admin/users/${u.userId}/role`, { role: 'admin' });
      await syncIdpClaims(t.deps, u.userId, claims({ isAdmin: false }));
      row = (await t.db.query.user.findFirst({ where: eq(userTable.id, u.userId) }))!;
      expect(row).toMatchObject({ role: 'admin', roleFromIdp: false });

      // null claims (no id token) only touch lastLoginAt
      t.clock.now = at(1);
      await syncIdpClaims(t.deps, u.userId, null);
      row = (await t.db.query.user.findFirst({ where: eq(userTable.id, u.userId) }))!;
      expect(row.role).toBe('admin');
      expect(row.lastLoginAt?.toISOString()).toBe(at(1).toISOString());
      await syncIdpClaims(t.deps, 'unknown-user', claims({}));
    });

    it('deactivates on invalid affiliation and reactivates automatically when valid again', async () => {
      const { u, k, litellmKeyId } = await userWithKey();
      await syncIdpClaims(t.deps, u.userId, claims({ affiliation: ['alumni'], affiliationValid: false }));
      let row = (await t.db.query.user.findFirst({ where: eq(userTable.id, u.userId) }))!;
      expect(row).toMatchObject({ affiliationValid: false, affiliation: ['alumni'], deletedReason: 'affiliation' });
      expect(row.deletedAt).not.toBeNull();
      expectError(await u.get('/me'), 403, 'ACCOUNT_INVALID_AFFILIATION');
      expect((await t.keyRow(k.id)).status).toBe('blocked');
      expect(t.mock.keys.get(litellmKeyId)!.blocked).toBe(true);
      expect(await t.notificationsOf('account_invalid_deactivated', u.email)).toHaveLength(1);

      await syncIdpClaims(t.deps, u.userId, claims({ affiliation: ['staff'], affiliationValid: true }));
      row = (await t.db.query.user.findFirst({ where: eq(userTable.id, u.userId) }))!;
      expect(row).toMatchObject({ affiliationValid: true, deletedAt: null, deletedReason: null, affiliation: ['staff'] });
      expect((await u.get('/me')).status).toBe(200);
      expect(t.mock.users.get(u.userId)!.blocked).toBe(false);
      // keys remain blocked after reactivation (F-USR-3)
      expect((await t.keyRow(k.id)).status).toBe('blocked');
    });

    it('does not reactivate users that were deactivated by an admin', async () => {
      const u = await t.login();
      await admin.post(`/admin/users/${u.userId}/deactivate`);
      await syncIdpClaims(t.deps, u.userId, claims({ affiliationValid: true }));
      const row = (await t.db.query.user.findFirst({ where: eq(userTable.id, u.userId) }))!;
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedReason).toBe('admin');
      expectError(await u.get('/me'), 403, 'ACCOUNT_DEACTIVATED');
    });
  });
});
