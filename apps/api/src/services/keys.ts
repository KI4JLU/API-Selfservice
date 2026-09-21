import { and, apiKeys, count, costCenters, desc, eq, inArray, ne, user } from '@litelite/db';
import type { KeyStatus } from '@litelite/shared';
import type { CurrentUser, Deps } from '../context.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { audit, auditError } from './audit.js';
import { ensureTeam, getCostCenter } from './cost-centers.js';
import { spendForKey } from './spend.js';
import { allowedModelsForCostCenter } from './providers.js';
import { getBudgetState } from './budgets.js';

type KeyRow = typeof apiKeys.$inferSelect;

function mask(secret: string) {
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

export async function keyView(deps: Deps, k: KeyRow) {
  const cc = await deps.db.query.costCenters.findFirst({ where: eq(costCenters.id, k.costCenterId) });
  return {
    id: k.id,
    name: k.name,
    maskedKey: k.maskedKey,
    costCenter: { id: k.costCenterId, number: cc?.number ?? '', name: cc?.name ?? '' },
    models: k.models,
    budget: k.budget === null ? null : Number(k.budget),
    spend: await spendForKey(deps, k.id),
    status: k.status,
    createdAt: k.createdAt.toISOString(),
    expiresAt: k.expiresAt.toISOString(),
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

export async function createKey(
  deps: Deps,
  cu: CurrentUser,
  input: { name: string; models: string[]; costCenterId: string; budget?: number | null },
) {
  const cc = await getCostCenter(deps, input.costCenterId);
  if (cc.status !== 'approved') throw new ApiError('COST_CENTER_NOT_APPROVED');
  const allowed = await allowedModelsForCostCenter(deps, cc);
  for (const m of input.models) {
    const p = allowed.find((a) => a.modelName === m);
    if (!p) {
      const paid = await deps.db.query.providers.findFirst({ where: eq((await import('@litelite/db')).providers.modelName, m) });
      if (paid && paid.tier === 'paid' && cc.isDefault) throw new ApiError('PAID_MODEL_REQUIRES_COST_CENTER', `Model ${m} requires a cost center`);
      throw new ApiError('MODEL_NOT_ALLOWED', `Model ${m} is not available`);
    }
  }
  const budgetState = await getBudgetState(deps, cu.id);
  if (budgetState.blocked || cc.blockedAt) throw new ApiError('KEY_NOT_ACTIVE', 'Budget exhausted');
  await assertKeyBudgets(deps, cu.id, input.budget ?? null);
  const expiresAt = new Date(deps.now().getTime() + deps.env.KEY_LIFETIME_DAYS * 86400000);
  // Keys hang on the cost center's LiteLLM team (E-8); the user id is shared with LiteLLM (E-7).
  const created = await deps.litellm.createKey({
    litellmUserId: cu.id,
    teamId: await ensureTeam(deps, cc),
    alias: `${cu.email}:${input.name}`,
    models: input.models,
    maxBudget: input.budget ?? null,
    expiresAt,
    metadata: { litelite_user: cu.id, cost_center: cc.number },
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
      models: input.models,
      budget: input.budget == null ? null : String(input.budget),
      expiresAt,
    })
    .returning();
  await audit(deps, { actorId: cu.id, action: 'key.create', entity: 'api_key', entityId: row!.id, payload: { name: input.name, models: input.models, costCenter: cc.number } });
  return { ...(await keyView(deps, row!)), secret: created.secret };
}

export async function updateKey(deps: Deps, cu: CurrentUser, id: string, input: { budget?: number | null; name?: string }) {
  const k = await getOwnKey(deps, cu, id);
  if (input.budget !== undefined) await assertKeyBudgets(deps, cu.id, input.budget, k.id);
  await deps.litellm.updateKey(k.litellmKeyId, { maxBudget: input.budget, alias: input.name ? `${cu.email}:${input.name}` : undefined });
  const [row] = await deps.db
    .update(apiKeys)
    .set({ ...(input.budget !== undefined ? { budget: input.budget == null ? null : String(input.budget) } : {}), ...(input.name ? { name: input.name } : {}) })
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

/** F-KEY-5a: extend by the configured lifetime from now; reactivates expired keys. */
export async function extendKey(deps: Deps, cu: CurrentUser, id: string) {
  const k = await getOwnKey(deps, cu, id);
  if (k.status === 'blocked' && k.blockedReason !== 'expired') throw new ApiError('KEY_NOT_ACTIVE', 'Key is blocked');
  const expiresAt = new Date(deps.now().getTime() + deps.env.KEY_LIFETIME_DAYS * 86400000);
  await deps.litellm.updateKey(k.litellmKeyId, { expiresAt, blocked: false });
  const [row] = await deps.db
    .update(apiKeys)
    .set({ expiresAt, lastExtendedAt: deps.now(), status: 'active', blockedReason: null, notified14d: false, notified1d: false })
    .where(eq(apiKeys.id, id))
    .returning();
  await audit(deps, { actorId: cu.id, action: 'key.extend', entity: 'api_key', entityId: id, payload: { expiresAt } });
  return keyView(deps, row!);
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
  await setBlocked(deps, rows.filter((r) => reasons.includes(r.blockedReason ?? '')), false, null);
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
