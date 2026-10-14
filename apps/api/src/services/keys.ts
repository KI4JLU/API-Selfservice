import { and, apiKeys, count, costCenters, desc, eq, inArray, ne, providers, user } from '@api-selfservice/db';
import { currentPeriod, type KeyBudgetPeriod, type KeyStatus } from '@api-selfservice/shared';
import type { CurrentUser, Deps } from '../context.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { audit, auditError } from './audit.js';
import { ensureTeam, getCostCenter } from './cost-centers.js';
import { isMember } from './cost-center-members.js';
import { spendForKey } from './spend.js';
import { allowedModelsForCostCenter } from './providers.js';
import { getBudgetState } from './budgets.js';
import { budgetDurationFor } from '../litellm/types.js';

type KeyRow = typeof apiKeys.$inferSelect;

function mask(secret: string) {
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

const DAY = 86400000;

/** #11: every key is rotated at the latest KEY_LIFETIME_DAYS after its creation, also after changing its expiry. */
function maxExpiry(deps: Deps, createdAt: Date) {
  return new Date(createdAt.getTime() + deps.env.KEY_LIFETIME_DAYS * DAY);
}

/**
 * The requested expiry, by default the latest allowed one. A "valid until" date picked in the UI ends at the end of
 * that day, which on the last allowed day lies a few hours after the limit; such a date is capped to the limit.
 */
function resolveExpiry(deps: Deps, createdAt: Date, requested?: string) {
  const max = maxExpiry(deps, createdAt);
  if (!requested) return max;
  const d = new Date(requested);
  if (d.getTime() <= deps.now().getTime() || d.getTime() > max.getTime() + DAY) {
    throw new ApiError('KEY_EXPIRY_OUT_OF_RANGE', `The expiry must lie after now and at most ${deps.env.KEY_LIFETIME_DAYS} days after the key was created`);
  }
  return d > max ? max : d;
}

/** The key's models grouped by provider; models without a known provider come last. */
async function modelGroups(deps: Deps, models: string[]) {
  const rows = models.length ? await deps.db.query.providers.findMany({ where: inArray(providers.modelName, models), columns: { modelName: true, provider: true } }) : [];
  const providerOf = new Map(rows.map((r) => [r.modelName, r.provider]));
  const groups = new Map<string | null, string[]>();
  for (const m of [...models].sort()) {
    const p = providerOf.get(m) ?? null;
    groups.set(p, [...(groups.get(p) ?? []), m]);
  }
  return [...groups.entries()].map(([provider, ms]) => ({ provider, models: ms })).sort((a, b) => (a.provider === null ? 1 : b.provider === null ? -1 : a.provider.localeCompare(b.provider)));
}

export async function keyView(deps: Deps, k: KeyRow) {
  const cc = await deps.db.query.costCenters.findFirst({ where: eq(costCenters.id, k.costCenterId) });
  return {
    id: k.id,
    name: k.name,
    maskedKey: k.maskedKey,
    costCenter: { id: k.costCenterId, number: cc?.number ?? '', name: cc?.name ?? '' },
    models: k.models,
    providers: k.providers,
    modelGroups: await modelGroups(deps, k.models),
    budget: k.budget === null ? null : Number(k.budget),
    budgetPeriod: k.budgetPeriod,
    // F-KEY-11: a monthly budget is compared with this month's spend
    spend: await spendForKey(deps, k.id, k.budgetPeriod ? currentPeriod(k.budgetPeriod, deps.now()) : undefined),
    // LiteLLM refuses an expired key right away (#11); the expiry job marks it later
    status: (k.status === 'active' && k.expiresAt <= deps.now() ? 'expired' : k.status) as KeyStatus,
    createdAt: k.createdAt.toISOString(),
    expiresAt: k.expiresAt.toISOString(),
    maxExpiresAt: maxExpiry(deps, k.createdAt).toISOString(),
    lastExtendedAt: k.lastExtendedAt?.toISOString() ?? null,
  };
}

export async function listMyKeys(deps: Deps, cu: CurrentUser) {
  const rows = await deps.db.query.apiKeys.findMany({
    where: and(eq(apiKeys.userId, cu.id), ne(apiKeys.status, 'deleted')),
    orderBy: [desc(apiKeys.createdAt)],
  });
  const items = [];
  for (const k of rows) items.push(await keyView(deps, k));
  return { items, total: items.length, page: 1, pageSize: items.length || 1 };
}

async function getOwnKey(deps: Deps, cu: CurrentUser, id: string): Promise<KeyRow> {
  const k = await deps.db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
  if (!k || k.status === 'deleted') throw notFound('Key');
  if (k.userId !== cu.id) throw forbidden();
  return k;
}

async function assertKeyBudgets(deps: Deps, userId: string, additional: number | null, excludeKeyId?: string) {
  const state = await getBudgetState(deps, userId);
  if (!state.budget) return;
  const rows = await deps.db.query.apiKeys.findMany({ where: and(eq(apiKeys.userId, userId), ne(apiKeys.status, 'deleted')) });
  const sum = rows.filter((r) => r.id !== excludeKeyId).reduce((a, r) => a + Number(r.budget ?? 0), 0) + (additional ?? 0);
  if (sum > state.budget.amount + 1e-9) throw new ApiError('KEY_BUDGET_EXCEEDS_USER_BUDGET');
}

/** F-KEY-10: allowed models of the given providers that the key does not have yet. */
function missingProviderModels(allowed: { modelName: string; provider: string | null }[], keyProviders: string[], models: string[]) {
  return allowed.filter((p) => p.provider !== null && keyProviders.includes(p.provider) && !models.includes(p.modelName)).map((p) => p.modelName);
}

export async function createKey(
  deps: Deps,
  cu: CurrentUser,
  input: { name: string; models: string[]; providers: string[]; costCenterId: string; budget?: number | null; budgetPeriod?: KeyBudgetPeriod | null; expiresAt?: string },
  /**
   * Set by a renewal: the LiteLLM alias (unique there) gets a suffix; `excludeBudgetOf` leaves the old key's budget out of
   * the user budget check, only when the old key cannot spend any more (deleted with the renewal or expired).
   */
  opts: { renewOf?: string; excludeBudgetOf?: string } = {},
) {
  const expiresAt = resolveExpiry(deps, deps.now(), input.expiresAt);
  const cc = await getCostCenter(deps, input.costCenterId);
  if (cc.status !== 'approved') throw new ApiError('COST_CENTER_NOT_APPROVED');
  if (!(await isMember(deps, cu.id, cc))) throw new ApiError('COST_CENTER_NOT_MEMBER');
  const allowed = await allowedModelsForCostCenter(deps, cc);
  for (const m of input.models) {
    const p = allowed.find((a) => a.modelName === m);
    if (!p) {
      const paid = await deps.db.query.providers.findFirst({ where: eq((await import('@api-selfservice/db')).providers.modelName, m) });
      if (paid && paid.tier === 'paid' && cc.isDefault) throw new ApiError('PAID_MODEL_REQUIRES_COST_CENTER', `Model ${m} requires a cost center`);
      throw new ApiError('MODEL_NOT_ALLOWED', `Model ${m} is not available`);
    }
  }
  const keyProviders = [...new Set(input.providers)];
  for (const pr of keyProviders) {
    if (!allowed.some((a) => a.provider === pr)) {
      const paid = await deps.db.query.providers.findFirst({ where: and(eq(providers.provider, pr), eq(providers.available, true)) });
      if (paid && cc.isDefault) throw new ApiError('PAID_MODEL_REQUIRES_COST_CENTER', `Provider ${pr} requires a cost center`);
      throw new ApiError('MODEL_NOT_ALLOWED', `Provider ${pr} is not available`);
    }
  }
  const models = [...new Set(input.models)];
  models.push(...missingProviderModels(allowed, keyProviders, models));
  // An empty model list means "all models" in LiteLLM; a key always names its models.
  if (models.length === 0) throw new ApiError('MODEL_NOT_ALLOWED', 'No released model for this key');
  const budgetState = await getBudgetState(deps, cu.id);
  if (budgetState.blocked || cc.blockedAt) throw new ApiError('KEY_NOT_ACTIVE', 'Budget exhausted');
  await assertKeyBudgets(deps, cu.id, input.budget ?? null, opts.excludeBudgetOf);
  // A period only makes sense with an amount (F-KEY-11).
  const budgetPeriod = input.budget == null ? null : (input.budgetPeriod ?? null);
  // Keys hang on the cost center's LiteLLM team (E-8); the user id is shared with LiteLLM (E-7).
  const created = await deps.litellm.createKey({
    litellmUserId: cu.id,
    teamId: await ensureTeam(deps, cc),
    alias: `${cu.email}:${input.name}${opts.renewOf ? ` #${crypto.randomUUID().slice(0, 6)}` : ''}`,
    models,
    maxBudget: input.budget ?? null,
    budgetDuration: budgetDurationFor(budgetPeriod),
    expiresAt,
    metadata: { api_selfservice_user: cu.id, cost_center: cc.number },
  });
  const [row] = await deps.db
    .insert(apiKeys)
    .values({
      userId: cu.id,
      litellmKeyId: created.keyId,
      keyHash: created.keyId,
      maskedKey: mask(created.secret),
      name: input.name,
      costCenterId: cc.id,
      models,
      providers: keyProviders,
      budget: input.budget == null ? null : String(input.budget),
      budgetPeriod,
      expiresAt,
      // the 6-month limit (#11) is counted from here, on the same clock as expiresAt
      createdAt: deps.now(),
    })
    .returning();
  await audit(deps, {
    actorId: cu.id,
    action: opts.renewOf ? 'key.renew' : 'key.create',
    entity: 'api_key',
    entityId: row!.id,
    payload: { name: input.name, models, providers: keyProviders, costCenter: cc.number, expiresAt, ...(opts.renewOf ? { renewedFrom: opts.renewOf } : {}) },
  });
  return { ...(await keyView(deps, row!)), secret: created.secret };
}

export async function updateKey(deps: Deps, cu: CurrentUser, id: string, input: { budget?: number | null; budgetPeriod?: KeyBudgetPeriod | null; name?: string; expiresAt?: string }) {
  const k = await getOwnKey(deps, cu, id);
  if (k.status === 'deleted') throw new ApiError('KEY_NOT_ACTIVE', 'Key is deleted');
  const expiresAt = input.expiresAt !== undefined ? resolveExpiry(deps, k.createdAt, input.expiresAt) : undefined;
  // #11: an expired key with a new date in the allowed range runs again; keys blocked for another reason stay blocked
  // (also before the expiry job has marked it: LiteLLM refuses it from its expiry on)
  // keys blocked for another reason (admin, budget) are never revived here
  const revives = expiresAt !== undefined && (k.status === 'expired' || k.blockedReason === 'expired' || (k.status === 'active' && k.expiresAt <= deps.now()));
  // like creating a key: no key comes back while the user's or the cost center's budget is exhausted
  if (revives) {
    const cc = await getCostCenter(deps, k.costCenterId);
    if ((await getBudgetState(deps, cu.id)).blocked || cc.blockedAt) throw new ApiError('KEY_NOT_ACTIVE', 'Budget exhausted');
  }
  if (input.budget !== undefined) await assertKeyBudgets(deps, cu.id, input.budget, k.id);
  // F-KEY-11: removing the amount also removes the period.
  const budget = input.budget !== undefined ? input.budget : k.budget === null ? null : Number(k.budget);
  const budgetPeriod = budget === null ? null : input.budgetPeriod !== undefined ? input.budgetPeriod : k.budgetPeriod;
  const periodChanged = budgetPeriod !== k.budgetPeriod;
  await deps.litellm.updateKey(k.litellmKeyId, {
    maxBudget: input.budget,
    ...(periodChanged ? { budgetDuration: budgetDurationFor(budgetPeriod) } : {}),
    alias: input.name ? `${cu.email}:${input.name}` : undefined,
    ...(expiresAt ? { expiresAt } : {}),
    // keys blocked at expiry before #11 are unblocked again
    ...(revives && k.blockedReason === 'expired' ? { blocked: false } : {}),
  });
  const [row] = await deps.db
    .update(apiKeys)
    .set({
      ...(input.budget !== undefined ? { budget: input.budget == null ? null : String(input.budget) } : {}),
      ...(periodChanged ? { budgetPeriod } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(expiresAt
        ? {
            expiresAt,
            // warnings start over for a later date
            ...(expiresAt > k.expiresAt ? { notified14d: false, notified1d: false } : {}),
            ...(revives ? { status: 'active' as const, blockedReason: null } : {}),
          }
        : {}),
    })
    .where(eq(apiKeys.id, id))
    .returning();
  await audit(deps, { actorId: cu.id, action: 'key.update', entity: 'api_key', entityId: id, payload: input });
  return keyView(deps, row!);
}

export async function deleteKey(deps: Deps, cu: CurrentUser, id: string) {
  const k = await getOwnKey(deps, cu, id);
  await deps.litellm.deleteKey(k.litellmKeyId);
  await deps.db.update(apiKeys).set({ status: 'deleted', deletedAt: deps.now() }).where(eq(apiKeys.id, id));
  await audit(deps, { actorId: cu.id, action: 'key.delete', entity: 'api_key', entityId: id });
}

/**
 * #11 (replaces extending, F-KEY-5a): a new key with a new secret and the same settings. The old key stays valid
 * until its own expiry, so applications can switch over, unless `revokeOld` deletes it right away.
 */
export async function renewKey(deps: Deps, cu: CurrentUser, id: string, input: { expiresAt?: string; revokeOld?: boolean }) {
  const k = await getOwnKey(deps, cu, id);
  if (k.status === 'deleted' || (k.status === 'blocked' && k.blockedReason !== 'expired')) throw new ApiError('KEY_NOT_ACTIVE', 'Only active or expired keys can be renewed');
  // Models and providers no longer released on the cost center are left out; a provider brings its current models again.
  // Nothing left -> createKey refuses (MODEL_NOT_ALLOWED) instead of creating a key without models.
  const allowed = await allowedModelsForCostCenter(deps, await getCostCenter(deps, k.costCenterId));
  const keyProviders = k.providers.filter((p) => allowed.some((a) => a.provider === p));
  const providerModels = new Set(missingProviderModels(allowed, keyProviders, []));
  const models = k.models.filter((m) => !providerModels.has(m) && allowed.some((a) => a.modelName === m));
  const oldCannotSpend = input.revokeOld || k.status === 'expired' || k.expiresAt <= deps.now();
  const created = await createKey(
    deps,
    cu,
    {
      name: k.name,
      models,
      providers: keyProviders,
      costCenterId: k.costCenterId,
      budget: k.budget === null ? null : Number(k.budget),
      budgetPeriod: k.budgetPeriod,
      expiresAt: input.expiresAt,
    },
    { renewOf: k.id, excludeBudgetOf: oldCannotSpend ? k.id : undefined },
  );
  // the old key gets no more expiry reminders (#11)
  await deps.db.update(apiKeys).set({ replacedBy: created.id }).where(eq(apiKeys.id, k.id));
  if (input.revokeOld) await deleteKey(deps, cu, k.id);
  return created;
}

/**
 * F-KEY-10: adds new allowed models of the key's providers to the key (LiteLLM and DB).
 * Runs after a provider sync or tier change. Models are only added, never removed, like
 * models picked one by one.
 */
export async function syncProviderKeyModels(deps: Deps) {
  const rows = (await deps.db.query.apiKeys.findMany({ where: ne(apiKeys.status, 'deleted') })).filter((k) => k.providers.length > 0);
  const allowedByCc = new Map<string, Awaited<ReturnType<typeof allowedModelsForCostCenter>>>();
  let updated = 0;
  for (const k of rows) {
    let allowed = allowedByCc.get(k.costCenterId);
    if (!allowed) {
      allowed = await allowedModelsForCostCenter(deps, await getCostCenter(deps, k.costCenterId));
      allowedByCc.set(k.costCenterId, allowed);
    }
    const added = missingProviderModels(allowed, k.providers, k.models);
    if (added.length === 0) continue;
    const models = [...k.models, ...added];
    try {
      await deps.litellm.updateKey(k.litellmKeyId, { models });
    } catch (e) {
      await auditError(deps, { action: 'litellm.update_key', entity: 'api_key', entityId: k.id, err: e, payload: { models } });
      continue;
    }
    await deps.db.update(apiKeys).set({ models }).where(eq(apiKeys.id, k.id));
    await audit(deps, { actorId: null, action: 'key.models_added', entity: 'api_key', entityId: k.id, payload: { added } });
    updated++;
  }
  return { updated };
}

// ---------- Admin ----------

export async function adminListKeys(deps: Deps, q: { page: number; pageSize: number; userId?: string; costCenterId?: string; status?: KeyStatus }) {
  const where = and(
    q.userId ? eq(apiKeys.userId, q.userId) : undefined,
    q.costCenterId ? eq(apiKeys.costCenterId, q.costCenterId) : undefined,
    q.status ? eq(apiKeys.status, q.status) : ne(apiKeys.status, 'deleted'),
  );
  const [{ total } = { total: 0 }] = await deps.db.select({ total: count() }).from(apiKeys).where(where);
  const rows = await deps.db
    .select({ k: apiKeys, u: { id: user.id, name: user.name, email: user.email } })
    .from(apiKeys)
    .innerJoin(user, eq(user.id, apiKeys.userId))
    .where(where)
    .orderBy(desc(apiKeys.createdAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const items = [];
  for (const r of rows) items.push({ ...(await keyView(deps, r.k)), user: r.u });
  return { items, total: Number(total), page: q.page, pageSize: q.pageSize };
}

export async function adminBlockKey(deps: Deps, actor: CurrentUser, id: string, blocked: boolean) {
  const k = await deps.db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
  if (!k || k.status === 'deleted') throw notFound('Key');
  await deps.litellm.updateKey(k.litellmKeyId, { blocked });
  const [row] = await deps.db
    .update(apiKeys)
    .set(blocked ? { status: 'blocked', blockedReason: 'admin' } : { status: 'active', blockedReason: null })
    .where(eq(apiKeys.id, id))
    .returning();
  await audit(deps, { actorId: actor.id, action: blocked ? 'key.block' : 'key.unblock', entity: 'api_key', entityId: id });
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, k.userId) });
  return { ...(await keyView(deps, row!)), user: { id: u!.id, name: u!.name, email: u!.email } };
}

// ---------- Bulk block/unblock used by budgets, cost centers, deactivation ----------

async function setBlocked(deps: Deps, rows: KeyRow[], blocked: boolean, reason: string | null) {
  for (const k of rows) {
    try {
      await deps.litellm.updateKey(k.litellmKeyId, { blocked });
    } catch (e) {
      await auditError(deps, { action: 'litellm.update_key', entity: 'api_key', entityId: k.id, err: e, payload: { blocked, reason } });
    }
    await deps.db
      .update(apiKeys)
      .set(blocked ? { status: 'blocked', blockedReason: reason } : { status: k.expiresAt < deps.now() ? 'expired' : 'active', blockedReason: null })
      .where(eq(apiKeys.id, k.id));
  }
}

export async function blockAllKeysOfUser(deps: Deps, userId: string, reason: string) {
  const rows = await deps.db.query.apiKeys.findMany({ where: and(eq(apiKeys.userId, userId), inArray(apiKeys.status, ['active', 'expired'])) });
  await setBlocked(deps, rows, true, reason);
}

/** Unblocks keys of a user whose blockedReason is in `reasons`. */
export async function unblockKeysOfUser(deps: Deps, userId: string, reasons: string[]) {
  const rows = await deps.db.query.apiKeys.findMany({ where: and(eq(apiKeys.userId, userId), eq(apiKeys.status, 'blocked')) });
  await setBlocked(
    deps,
    rows.filter((r) => reasons.includes(r.blockedReason ?? '')),
    false,
    null,
  );
}

export async function blockKeysOfCostCenter(deps: Deps, costCenterId: string, reason: string) {
  const rows = await deps.db.query.apiKeys.findMany({ where: and(eq(apiKeys.costCenterId, costCenterId), inArray(apiKeys.status, ['active', 'expired'])) });
  await setBlocked(deps, rows, true, reason);
}

export async function unblockKeysOfCostCenter(deps: Deps, costCenterId: string) {
  const rows = await deps.db.query.apiKeys.findMany({
    where: and(eq(apiKeys.costCenterId, costCenterId), eq(apiKeys.status, 'blocked'), eq(apiKeys.blockedReason, 'cost_center_budget')),
  });
  await setBlocked(deps, rows, false, null);
}

/**
 * F-KST-12: removing a member deletes their keys on that cost center. LiteLLM deletes a member's
 * team keys on /team/member_delete anyway, so they could not be unblocked later.
 */
export async function deleteKeysOfMember(deps: Deps, actor: CurrentUser, userId: string, costCenterId: string) {
  const rows = await deps.db.query.apiKeys.findMany({
    where: and(eq(apiKeys.userId, userId), eq(apiKeys.costCenterId, costCenterId), ne(apiKeys.status, 'deleted')),
  });
  for (const k of rows) {
    try {
      await deps.litellm.deleteKey(k.litellmKeyId);
    } catch (e) {
      await auditError(deps, { action: 'litellm.delete_key', entity: 'api_key', entityId: k.id, err: e, payload: { reason: 'cost_center_member_removed' } });
    }
    await deps.db.update(apiKeys).set({ status: 'deleted', deletedAt: deps.now() }).where(eq(apiKeys.id, k.id));
    await audit(deps, { actorId: actor.id, action: 'key.delete', entity: 'api_key', entityId: k.id, payload: { reason: 'cost_center_member_removed', userId } });
  }
}
