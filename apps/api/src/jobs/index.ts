import { Cron } from 'croner';
import type { Deps } from '../context.js';
import { ingestSpendLogs } from '../services/spend.js';
import { evaluateUserBudget } from '../services/budgets.js';
import { evaluateCostCenterBudget } from '../services/cost-centers.js';
import { budgets, costCenters, apiKeys, and, eq, inArray, isNull, user, lt, lte } from '@api-selfservice/db';
import { notifyUser, notifyAdmins } from '../services/notifications.js';
import { syncProviders } from '../services/providers.js';
import { usersDueForDeletion } from '../services/users.js';
import { createKeycloakAdmin, type KeycloakAdmin } from '../auth/keycloak-admin.js';
import { audit, auditError } from '../services/audit.js';

/** Ingest LiteLLM logs, then re-evaluate budgets. Safe to call repeatedly. */
export async function runIngestAndBudgets(deps: Deps) {
  const res = await ingestSpendLogs(deps);
  const bs = await deps.db.query.budgets.findMany();
  for (const b of bs) await evaluateUserBudget(deps, b.userId);
  const ccs = await deps.db.query.costCenters.findMany({ where: eq(costCenters.status, 'approved') });
  for (const cc of ccs) await evaluateCostCenterBudget(deps, cc);
  return res;
}

/** F-KEY-4/5: warn at 14d and 1d, block at expiry. */
export async function runKeyExpiry(deps: Deps) {
  const now = deps.now();
  const in14 = new Date(now.getTime() + 14 * 86400000);
  const in1 = new Date(now.getTime() + 1 * 86400000);
  const active = await deps.db.query.apiKeys.findMany({ where: eq(apiKeys.status, 'active') });
  let warned = 0;
  let expired = 0;
  for (const k of active) {
    const vars = { keyName: k.name, expiresAt: k.expiresAt.toISOString().slice(0, 10) };
    if (k.expiresAt <= now) {
      try {
        await deps.litellm.updateKey(k.litellmKeyId, { blocked: true });
      } catch (e) {
        await auditError(deps, { action: 'litellm.update_key', entity: 'api_key', entityId: k.id, err: e, payload: { blocked: true, reason: 'expired' } });
      }
      await deps.db.update(apiKeys).set({ status: 'expired', blockedReason: 'expired' }).where(eq(apiKeys.id, k.id));
      await notifyUser(deps, k.userId, 'key_expired', vars);
      await audit(deps, { actorId: null, action: 'key.expire', entity: 'api_key', entityId: k.id, payload: vars });
      expired++;
    } else if (k.expiresAt <= in1 && !k.notified1d) {
      await deps.db.update(apiKeys).set({ notified1d: true, notified14d: true }).where(eq(apiKeys.id, k.id));
      await notifyUser(deps, k.userId, 'key_expires_1d', vars);
      warned++;
    } else if (k.expiresAt <= in14 && !k.notified14d) {
      await deps.db.update(apiKeys).set({ notified14d: true }).where(eq(apiKeys.id, k.id));
      await notifyUser(deps, k.userId, 'key_expires_14d', vars);
      warned++;
    }
  }
  return { warned, expired };
}

/** F-USR-5: remind admins about users past the retention period (once per user). */
export async function runDeletionReminder(deps: Deps) {
  const due = await usersDueForDeletion(deps);
  const { jobState } = await import('@api-selfservice/db');
  let sent = 0;
  for (const u of due) {
    const key = `deletion_due:${u.id}`;
    const done = await deps.db.query.jobState.findFirst({ where: eq(jobState.key, key) });
    if (done) continue;
    await notifyAdmins(deps, 'deletion_due', { userEmail: u.email, userName: u.name, deletedAt: u.deletedAt!.toISOString().slice(0, 10) });
    await deps.db
      .insert(jobState)
      .values({ key, value: { at: deps.now().toISOString() } })
      .onConflictDoNothing();
    sent++;
  }
  return { due: due.length, sent };
}

/**
 * F-USR-4 (Austrittsprozess). With Keycloak Admin API credentials every active user is re-checked
 * (exists, enabled, affiliation, admin group). Without them we rely on the claims captured at the
 * last login. A Keycloak outage never deactivates anyone (O-7): the job logs and returns.
 */
export async function runAffiliationCheck(deps: Deps, admin: KeycloakAdmin | null = createKeycloakAdmin(deps.env)) {
  const { deactivateUser, keycloakSubjects, syncIdpClaims } = await import('../services/users.js');
  const active = await deps.db.query.user.findMany({ where: isNull(user.deletedAt) });
  let checked = 0;
  let deactivated = 0;
  if (admin) {
    const subs = await keycloakSubjects(
      deps,
      active.map((u) => u.id),
    );
    for (const u of active) {
      const sub = subs.get(u.id);
      if (!sub) continue;
      let info;
      try {
        info = await admin.getUser(sub);
      } catch (e) {
        await auditError(deps, { action: 'job.aborted', entity: 'job', entityId: 'affiliation', err: e, payload: { userId: u.id, reason: 'keycloak admin check failed' } });
        return { checked, deactivated, aborted: true };
      }
      checked++;
      const affiliationValid = deps.env.KEYCLOAK_AFFILIATION_VALID.length === 0 || (info?.affiliation ?? []).some((a) => deps.env.KEYCLOAK_AFFILIATION_VALID.includes(a));
      const valid = info !== null && info.enabled && affiliationValid;
      await syncIdpClaims(
        deps,
        u.id,
        {
          sub,
          affiliation: info?.affiliation ?? [],
          isAdmin: (info?.groups ?? []).includes(deps.env.KEYCLOAK_ADMIN_GROUP),
          affiliationValid: valid,
        },
        { touchLogin: false },
      );
      if (!valid) deactivated++;
    }
    return { checked, deactivated, aborted: false };
  }
  if (deps.env.KEYCLOAK_AFFILIATION_VALID.length === 0) return { checked: 0, deactivated: 0, aborted: false };
  const invalid = active.filter((u) => !u.affiliationValid);
  for (const u of invalid) {
    await deactivateUser(deps, u.id, 'affiliation', null);
    deactivated++;
  }
  return { checked: active.length, deactivated, aborted: false };
}

/** Runs one job; a failure is logged to the event log (severity error) and never propagates into the scheduler. */
export async function runJob(deps: Deps, name: string, fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    deps.log.info({ job: name, result: r }, 'job done');
    return r;
  } catch (e) {
    await auditError(deps, { action: 'job.failed', entity: 'job', entityId: name, err: e });
    return null;
  }
}

export function startJobs(deps: Deps) {
  const guard = (name: string, fn: () => Promise<unknown>) => async () => {
    await runJob(deps, name, fn);
  };
  const jobs = [
    new Cron(
      deps.env.LOG_INGEST_CRON,
      guard('ingest', () => runIngestAndBudgets(deps)),
    ),
    new Cron(
      '15 * * * *',
      guard('key-expiry', () => runKeyExpiry(deps)),
    ),
    new Cron(
      '30 4 * * *',
      guard('deletion-reminder', () => runDeletionReminder(deps)),
    ),
    new Cron(
      deps.env.AFFILIATION_CHECK_CRON,
      guard('affiliation', () => runAffiliationCheck(deps)),
    ),
    new Cron(
      '45 */6 * * *',
      guard('provider-sync', () => syncProviders(deps, null)),
    ),
  ];
  deps.log.info({ count: jobs.length }, 'cron jobs started');
  return () => jobs.forEach((j) => j.stop());
}

export { budgets as _b, inArray as _i, lt as _lt, lte as _lte };
