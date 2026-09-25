import { and, apiKeys, costCenterAdmins, costCenterRequests, costCenters, count, desc, eq, ilike, ne, or, user } from '@api-selfservice/db';
import { DEFAULT_COST_CENTER, currentPeriod, normalizeCostCenter, type BudgetPeriod, type CostCenterStatus } from '@api-selfservice/shared';
import type { CurrentUser, Deps } from '../context.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { audit, auditError } from './audit.js';
import { notify, notifyAdmins, notifyUser } from './notifications.js';
import { spendForCostCenter } from './spend.js';
import { blockKeysOfCostCenter, unblockKeysOfCostCenter } from './keys.js';
import { budgetDurationFor } from '../litellm/types.js';

type CC = typeof costCenters.$inferSelect;

export async function getDefaultCostCenter(deps: Pick<Deps, 'db'>): Promise<CC> {
  const cc = await deps.db.query.costCenters.findFirst({ where: eq(costCenters.isDefault, true) });
  if (cc) return cc;
  const [created] = await deps.db
    .insert(costCenters)
    .values({
      number: DEFAULT_COST_CENTER,
      name: 'Default (kostenfreie Provider)',
      ownerName: 'System',
      ownerEmail: 'noreply@api-selfservice.invalid',
      status: 'approved',
      isDefault: true,
    })
    .onConflictDoNothing()
    .returning();
  return created ?? (await deps.db.query.costCenters.findFirst({ where: eq(costCenters.number, DEFAULT_COST_CENTER) }))!;
}

export function costCenterPeriod(cc: CC, now: Date) {
  return currentPeriod((cc.budgetPeriod ?? 'monthly') as BudgetPeriod, now, cc.periodStart, cc.periodEnd);
}

// ---------- LiteLLM teams (PRD E-8: one team per cost center, team_id = cost center id) ----------

const teamAlias = (cc: Pick<CC, 'number' | 'name'>) => `${cc.number} ${cc.name}`;

/**
 * Ensures the LiteLLM team behind an approved cost center exists and remembers it in `litellm_team_id`.
 * Returns null (and logs) when LiteLLM is unavailable; callers degrade gracefully and retry on the next use.
 */
export async function ensureTeam(deps: Deps, cc: CC): Promise<string | null> {
  if (cc.litellmTeamId) return cc.litellmTeamId;
  if (cc.status !== 'approved') return null;
  try {
    const existing = await deps.litellm.getTeam(cc.id);
    if (!existing) {
      await deps.litellm.createTeam({
        teamId: cc.id,
        alias: teamAlias(cc),
        maxBudget: cc.maxBudget === null ? null : Number(cc.maxBudget),
        budgetDuration: budgetDurationFor(cc.budgetPeriod),
        metadata: { cost_center: cc.number, api_selfservice: true },
      });
    }
    await deps.db.update(costCenters).set({ litellmTeamId: cc.id }).where(eq(costCenters.id, cc.id));
    cc.litellmTeamId = cc.id;
    return cc.id;
  } catch (e) {
    await auditError(deps, { action: 'litellm.ensure_team', entity: 'cost_center', entityId: cc.id, err: e });
    return null;
  }
}

/**
 * Mirrors a user's relation to a cost center into LiteLLM team membership:
 * `admin` for cost-center admins, `user` for members via their profile, otherwise removed.
 */
export async function syncTeamMembership(deps: Deps, userId: string, costCenterId: string) {
  const cc = await deps.db.query.costCenters.findFirst({ where: eq(costCenters.id, costCenterId) });
  if (!cc) return;
  const teamId = cc.litellmTeamId ?? (await ensureTeam(deps, cc));
  if (!teamId) return;
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, userId) });
  const manages = await deps.db.query.costCenterAdmins.findFirst({
    where: and(eq(costCenterAdmins.userId, userId), eq(costCenterAdmins.costCenterId, costCenterId)),
  });
  const role = manages ? 'admin' : u && !u.deletedAt && u.costCenterId === costCenterId ? 'user' : null;
  try {
    if (role) await deps.litellm.setTeamMember(teamId, userId, role);
    else await deps.litellm.removeTeamMember(teamId, userId);
  } catch (e) {
    await auditError(deps, { action: 'litellm.sync_team_member', entity: 'cost_center', entityId: costCenterId, err: e, payload: { userId, role } });
  }
}

async function setTeamBlocked(deps: Deps, cc: CC, blocked: boolean) {
  if (!cc.litellmTeamId) return;
  try {
    await deps.litellm.setTeamBlocked(cc.litellmTeamId, blocked);
  } catch (e) {
    await auditError(deps, { action: 'litellm.set_team_blocked', entity: 'cost_center', entityId: cc.id, err: e, payload: { blocked } });
  }
}

export async function costCenterView(deps: Deps, cc: CC) {
  const p = costCenterPeriod(cc, deps.now());
  const spend = await spendForCostCenter(deps, cc.id, p.start, p.end);
  return {
    id: cc.id,
    number: cc.number,
    name: cc.name,
    ownerName: cc.ownerName,
    ownerEmail: cc.ownerEmail,
    maxBudget: cc.maxBudget === null ? null : Number(cc.maxBudget),
    budgetPeriod: cc.budgetPeriod,
    periodStart: cc.periodStart?.toISOString() ?? null,
    periodEnd: cc.periodEnd?.toISOString() ?? null,
    status: cc.status,
    isDefault: cc.isDefault,
    spendCurrentPeriod: spend,
    blocked: cc.blockedAt !== null,
    requestedBy: cc.requestedBy,
    approvedBy: cc.approvedBy,
    createdAt: cc.createdAt.toISOString(),
    updatedAt: cc.updatedAt.toISOString(),
  };
}

export async function getCostCenter(deps: Deps, id: string): Promise<CC> {
  const cc = await deps.db.query.costCenters.findFirst({ where: eq(costCenters.id, id) });
  if (!cc) throw notFound('Cost center');
  return cc;
}

export async function listCostCenters(
  deps: Deps,
  cu: CurrentUser,
  q: { status?: CostCenterStatus; q?: string; page: number; pageSize: number },
) {
  // Non-admins only see approved (lookup) plus their managed ones.
  const statusFilter = cu.role === 'admin' ? (q.status ? eq(costCenters.status, q.status) : undefined) : eq(costCenters.status, 'approved');
  const where = and(statusFilter, q.q ? or(ilike(costCenters.number, `%${q.q.replace(/\s/g, '')}%`), ilike(costCenters.name, `%${q.q}%`)) : undefined);
  const [{ total } = { total: 0 }] = await deps.db.select({ total: count() }).from(costCenters).where(where);
  const rows = await deps.db.query.costCenters.findMany({
    where,
    orderBy: [desc(costCenters.isDefault), costCenters.number],
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  const items = [];
  for (const cc of rows) items.push(await costCenterView(deps, cc));
  return { items, total: Number(total), page: q.page, pageSize: q.pageSize };
}

export async function listManagedCostCenters(deps: Deps, cu: CurrentUser) {
  const rows = cu.role === 'admin'
    ? await deps.db.query.costCenters.findMany({ where: ne(costCenters.status, 'rejected'), orderBy: [costCenters.number] })
    : await deps.db
        .select({ cc: costCenters })
        .from(costCenterAdmins)
        .innerJoin(costCenters, eq(costCenters.id, costCenterAdmins.costCenterId))
        .where(eq(costCenterAdmins.userId, cu.id))
        .then((r) => r.map((x) => x.cc));
  const items = [];
  for (const cc of rows) items.push(await costCenterView(deps, cc));
  return { items, total: items.length, page: 1, pageSize: items.length || 1 };
}

/** User requests a new cost center (F-KST-2). */
export async function requestCostCenter(
  deps: Deps,
  cu: CurrentUser,
  input: { number: string; name: string; ownerName: string; ownerEmail: string },
) {
  const number = normalizeCostCenter(input.number);
  if (!number) throw new ApiError('VALIDATION_ERROR', 'Cost center must be 8 digits');
  let cc = await deps.db.query.costCenters.findFirst({ where: eq(costCenters.number, number) });
  if (cc?.status === 'approved') throw new ApiError('COST_CENTER_EXISTS', 'Cost center is already approved; select it in your profile');
  if (cc?.status === 'archived') throw new ApiError('COST_CENTER_NOT_APPROVED', 'Cost center is archived');
  const open = await deps.db.query.costCenterRequests.findFirst({
    where: and(eq(costCenterRequests.userId, cu.id), eq(costCenterRequests.status, 'pending')),
  });
  if (open) throw new ApiError('COST_CENTER_REQUEST_PENDING');
  if (!cc) {
    [cc] = await deps.db
      .insert(costCenters)
      .values({ number, name: input.name, ownerName: input.ownerName, ownerEmail: input.ownerEmail, status: 'pending', requestedBy: cu.id })
      .returning();
  } else if (cc.status === 'rejected') {
    [cc] = await deps.db
      .update(costCenters)
      .set({ name: input.name, ownerName: input.ownerName, ownerEmail: input.ownerEmail, status: 'pending', requestedBy: cu.id, updatedAt: deps.now() })
      .where(eq(costCenters.id, cc.id))
      .returning();
  }
  const [req] = await deps.db.insert(costCenterRequests).values({ userId: cu.id, costCenterId: cc!.id }).returning();
  await audit(deps, { actorId: cu.id, action: 'cost_center.request', entity: 'cost_center', entityId: cc!.id, payload: { number } });
  await notifyAdmins(deps, 'cost_center_request_created', {
    userName: cu.name,
    userEmail: cu.email,
    number,
    name: input.name,
    ownerName: input.ownerName,
    ownerEmail: input.ownerEmail,
  });
  return requestView(deps, req!.id);
}

export async function adminCreateCostCenter(
  deps: Deps,
  actor: CurrentUser,
  input: {
    number: string;
    name: string;
    ownerName: string;
    ownerEmail: string;
    maxBudget?: number | null;
    budgetPeriod?: BudgetPeriod | null;
    periodStart?: string | null;
    periodEnd?: string | null;
  },
) {
  const number = normalizeCostCenter(input.number);
  if (!number) throw new ApiError('VALIDATION_ERROR', 'Cost center must be 8 digits');
  const existing = await deps.db.query.costCenters.findFirst({ where: eq(costCenters.number, number) });
  if (existing) throw new ApiError('COST_CENTER_EXISTS');
  const [cc] = await deps.db
    .insert(costCenters)
    .values({
      number,
      name: input.name,
      ownerName: input.ownerName,
      ownerEmail: input.ownerEmail,
      maxBudget: input.maxBudget == null ? null : String(input.maxBudget),
      budgetPeriod: input.budgetPeriod ?? (input.maxBudget != null ? 'monthly' : null),
      periodStart: input.periodStart ? new Date(input.periodStart) : null,
      periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
      status: 'approved',
      approvedBy: actor.id,
    })
    .returning();
  await audit(deps, { actorId: actor.id, action: 'cost_center.create', entity: 'cost_center', entityId: cc!.id, payload: { number } });
  await ensureTeam(deps, cc!);
  return costCenterView(deps, cc!);
}

export async function updateCostCenter(
  deps: Deps,
  actor: CurrentUser,
  id: string,
  input: {
    name?: string;
    ownerName?: string;
    ownerEmail?: string;
    maxBudget?: number | null;
    budgetPeriod?: BudgetPeriod | null;
    periodStart?: string | null;
    periodEnd?: string | null;
  },
) {
  const cc = await getCostCenter(deps, id);
  const isAdmin = actor.role === 'admin';
  const manages = actor.managedCostCenterIds.includes(id);
  if (!isAdmin && !manages) throw forbidden();
  if (cc.isDefault && (input.name !== undefined || input.ownerName !== undefined || input.ownerEmail !== undefined)) {
    throw new ApiError('COST_CENTER_DEFAULT_IMMUTABLE');
  }
  const patch: Partial<typeof costCenters.$inferInsert> = { updatedAt: deps.now() };
  if (isAdmin) {
    if (input.name !== undefined) patch.name = input.name;
    if (input.ownerName !== undefined) patch.ownerName = input.ownerName;
    if (input.ownerEmail !== undefined) patch.ownerEmail = input.ownerEmail;
  } else if (input.name !== undefined || input.ownerName !== undefined || input.ownerEmail !== undefined) {
    throw forbidden('Cost center admins may only change the budget');
  }
  if (input.maxBudget !== undefined) patch.maxBudget = input.maxBudget == null ? null : String(input.maxBudget);
  if (input.budgetPeriod !== undefined) patch.budgetPeriod = input.budgetPeriod;
  if (input.periodStart !== undefined) patch.periodStart = input.periodStart ? new Date(input.periodStart) : null;
  if (input.periodEnd !== undefined) patch.periodEnd = input.periodEnd ? new Date(input.periodEnd) : null;
  const [updated] = await deps.db.update(costCenters).set(patch).where(eq(costCenters.id, id)).returning();
  await audit(deps, { actorId: actor.id, action: 'cost_center.update', entity: 'cost_center', entityId: id, payload: input });
  const teamId = updated!.litellmTeamId ?? (await ensureTeam(deps, updated!));
  if (teamId) {
    try {
      await deps.litellm.updateTeam(teamId, {
        ...(input.name !== undefined ? { alias: teamAlias(updated!) } : {}),
        ...(input.maxBudget !== undefined ? { maxBudget: input.maxBudget } : {}),
        ...(input.budgetPeriod !== undefined ? { budgetDuration: budgetDurationFor(input.budgetPeriod) } : {}),
      });
    } catch (e) {
      await auditError(deps, { action: 'litellm.update_team', entity: 'cost_center', entityId: id, err: e, actorId: actor.id });
    }
  }
  // Raising the budget lifts a block (F-KST-6).
  if (updated!.blockedAt && input.maxBudget !== undefined) await evaluateCostCenterBudget(deps, updated!);
  return costCenterView(deps, (await getCostCenter(deps, id))!);
}

export async function archiveCostCenter(deps: Deps, actor: CurrentUser, id: string) {
  const cc = await getCostCenter(deps, id);
  if (cc.isDefault) throw new ApiError('COST_CENTER_DEFAULT_IMMUTABLE');
  const def = await getDefaultCostCenter(deps);
  const moved = await deps.db.query.user.findMany({ where: eq(user.costCenterId, id) });
  await deps.db.transaction(async (tx) => {
    await tx.update(costCenters).set({ status: 'archived', updatedAt: deps.now() }).where(eq(costCenters.id, id));
    await tx.update(user).set({ costCenterId: def.id }).where(eq(user.costCenterId, id));
  });
  await blockKeysOfCostCenter(deps, id, 'cost_center_archived');
  await setTeamBlocked(deps, cc, true);
  for (const u of moved) {
    await syncTeamMembership(deps, u.id, id);
    await syncTeamMembership(deps, u.id, def.id);
  }
  await audit(deps, { actorId: actor.id, action: 'cost_center.archive', entity: 'cost_center', entityId: id });
  return costCenterView(deps, await getCostCenter(deps, id));
}

// ---------- Requests ----------

export async function requestView(deps: Deps, id: string) {
  const [r] = await deps.db
    .select({ req: costCenterRequests, u: { id: user.id, name: user.name, email: user.email }, cc: costCenters })
    .from(costCenterRequests)
    .innerJoin(user, eq(user.id, costCenterRequests.userId))
    .innerJoin(costCenters, eq(costCenters.id, costCenterRequests.costCenterId))
    .where(eq(costCenterRequests.id, id));
  if (!r) throw notFound('Request');
  return {
    id: r.req.id,
    user: r.u,
    costCenter: { id: r.cc.id, number: r.cc.number, name: r.cc.name, ownerName: r.cc.ownerName, ownerEmail: r.cc.ownerEmail },
    status: r.req.status,
    reason: r.req.reason,
    decidedBy: r.req.decidedBy,
    decidedAt: r.req.decidedAt?.toISOString() ?? null,
    createdAt: r.req.createdAt.toISOString(),
  };
}

export async function listRequests(deps: Deps, q: { status?: 'pending' | 'approved' | 'rejected'; page: number; pageSize: number }) {
  const where = q.status ? eq(costCenterRequests.status, q.status) : undefined;
  const [{ total } = { total: 0 }] = await deps.db.select({ total: count() }).from(costCenterRequests).where(where);
  const rows = await deps.db.query.costCenterRequests.findMany({
    where,
    orderBy: [desc(costCenterRequests.createdAt)],
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  const items = [];
  for (const r of rows) items.push(await requestView(deps, r.id));
  return { items, total: Number(total), page: q.page, pageSize: q.pageSize };
}

export async function approveRequest(deps: Deps, actor: CurrentUser, id: string) {
  const req = await deps.db.query.costCenterRequests.findFirst({ where: eq(costCenterRequests.id, id) });
  if (!req) throw notFound('Request');
  if (req.status !== 'pending') return requestView(deps, id);
  const requester = await deps.db.query.user.findFirst({ where: eq(user.id, req.userId) });
  await deps.db.transaction(async (tx) => {
    await tx.update(costCenterRequests).set({ status: 'approved', decidedBy: actor.id, decidedAt: deps.now() }).where(eq(costCenterRequests.id, id));
    await tx.update(costCenters).set({ status: 'approved', approvedBy: actor.id, updatedAt: deps.now() }).where(eq(costCenters.id, req.costCenterId));
    await tx.update(user).set({ costCenterId: req.costCenterId, updatedAt: deps.now() }).where(eq(user.id, req.userId));
  });
  const cc = await getCostCenter(deps, req.costCenterId);
  await audit(deps, { actorId: actor.id, action: 'cost_center.approve', entity: 'cost_center', entityId: cc.id });
  await ensureTeam(deps, cc);
  if (requester?.costCenterId && requester.costCenterId !== cc.id) await syncTeamMembership(deps, req.userId, requester.costCenterId);
  await syncTeamMembership(deps, req.userId, cc.id);
  await notifyUser(deps, req.userId, 'cost_center_request_approved', { number: cc.number, name: cc.name });
  return requestView(deps, id);
}

export async function rejectRequest(deps: Deps, actor: CurrentUser, id: string, reason: string) {
  const req = await deps.db.query.costCenterRequests.findFirst({ where: eq(costCenterRequests.id, id) });
  if (!req) throw notFound('Request');
  if (req.status !== 'pending') return requestView(deps, id);
  await deps.db.transaction(async (tx) => {
    await tx
      .update(costCenterRequests)
      .set({ status: 'rejected', reason, decidedBy: actor.id, decidedAt: deps.now() })
      .where(eq(costCenterRequests.id, id));
    await tx.update(costCenters).set({ status: 'rejected', updatedAt: deps.now() }).where(and(eq(costCenters.id, req.costCenterId), eq(costCenters.status, 'pending')));
  });
  const cc = await getCostCenter(deps, req.costCenterId);
  await audit(deps, { actorId: actor.id, action: 'cost_center.reject', entity: 'cost_center', entityId: cc.id, payload: { reason } });
  await notifyUser(deps, req.userId, 'cost_center_request_rejected', { number: cc.number, name: cc.name, reason });
  return requestView(deps, id);
}

// ---------- Budget evaluation (F-KST-5/6) ----------

export async function evaluateCostCenterBudget(deps: Deps, cc: CC) {
  if (cc.maxBudget === null) {
    if (cc.blockedAt) {
      await deps.db.update(costCenters).set({ blockedAt: null }).where(eq(costCenters.id, cc.id));
      await unblockKeysOfCostCenter(deps, cc.id);
      await setTeamBlocked(deps, cc, false);
    }
    return;
  }
  const max = Number(cc.maxBudget);
  const p = costCenterPeriod(cc, deps.now());
  const spend = await spendForCostCenter(deps, cc.id, p.start, p.end);
  const ratio = max > 0 ? spend / max : 1;
  const recipients = await ccBudgetRecipients(deps, cc);
  const vars = { number: cc.number, name: cc.name, spend: spend.toFixed(2), budget: max.toFixed(2), percent: Math.round(ratio * 100) };

  if (ratio >= 1) {
    if (!cc.blockedAt) {
      await deps.db.update(costCenters).set({ blockedAt: deps.now() }).where(eq(costCenters.id, cc.id));
      await blockKeysOfCostCenter(deps, cc.id, 'cost_center_budget');
      await setTeamBlocked(deps, cc, true);
      for (const r of recipients) await notify(deps, { type: 'cost_center_budget_100', to: r.email, locale: r.locale, userId: r.userId, vars });
      await audit(deps, { actorId: null, action: 'cost_center.block', entity: 'cost_center', entityId: cc.id, payload: vars, severity: 'warning' });
    }
    return;
  }
  if (cc.blockedAt) {
    // New period or raised budget: unblock.
    await deps.db.update(costCenters).set({ blockedAt: null }).where(eq(costCenters.id, cc.id));
    await unblockKeysOfCostCenter(deps, cc.id);
    await setTeamBlocked(deps, cc, false);
    await audit(deps, { actorId: null, action: 'cost_center.unblock', entity: 'cost_center', entityId: cc.id });
  }
  if (ratio >= deps.env.BUDGET_WARN_THRESHOLD) {
    const key = `cc80:${cc.id}:${p.start.toISOString()}`;
    const { jobState } = await import('@api-selfservice/db');
    const sent = await deps.db.query.jobState.findFirst({ where: eq(jobState.key, key) });
    if (!sent) {
      for (const r of recipients) await notify(deps, { type: 'cost_center_budget_80', to: r.email, locale: r.locale, userId: r.userId, vars });
      await deps.db.insert(jobState).values({ key, value: { at: deps.now().toISOString() } }).onConflictDoNothing();
      await audit(deps, { actorId: null, action: 'cost_center.warn', entity: 'cost_center', entityId: cc.id, payload: vars, severity: 'warning' });
    }
  }
}

async function ccBudgetRecipients(deps: Deps, cc: CC) {
  const out = new Map<string, { email: string; locale: 'de' | 'en'; userId: string | null }>();
  out.set(cc.ownerEmail.toLowerCase(), { email: cc.ownerEmail, locale: 'de', userId: null });
  const admins = await deps.db
    .select({ email: user.email, locale: user.locale, id: user.id })
    .from(costCenterAdmins)
    .innerJoin(user, eq(user.id, costCenterAdmins.userId))
    .where(eq(costCenterAdmins.costCenterId, cc.id));
  for (const a of admins) out.set(a.email.toLowerCase(), { email: a.email, locale: a.locale, userId: a.id });
  return [...out.values()];
}

export async function keysOfCostCenterCount(deps: Deps, id: string) {
  const [{ n } = { n: 0 }] = await deps.db.select({ n: count() }).from(apiKeys).where(and(eq(apiKeys.costCenterId, id), ne(apiKeys.status, 'deleted')));
  return Number(n);
}
