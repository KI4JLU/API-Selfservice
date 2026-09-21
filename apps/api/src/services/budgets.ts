import { and, budgets, costCenters, count, desc, eq, isNull, user } from '@litelite/db';
import { currentPeriod, monthPeriod, monthKey, type BudgetPeriod } from '@litelite/shared';
import type { CurrentUser, Deps } from '../context.js';
import { notFound } from '../errors.js';
import { budgetDurationFor } from '../litellm/types.js';
import { audit, auditError } from './audit.js';
import { notifyUser } from './notifications.js';
import { blockAllKeysOfUser, unblockKeysOfUser } from './keys.js';
import { breakdown, monthlyHistory, spendForUser } from './spend.js';

type B = typeof budgets.$inferSelect;

export interface BudgetState {
  budget: { amount: number; period: BudgetPeriod; periodStart: Date | null; periodEnd: Date | null; assignedBy: string | null; createdAt: Date; row: B } | null;
  period: { start: Date; end: Date };
  spend: number;
  remaining: number | null;
  utilization: number | null;
  blocked: boolean;
}

export async function getBudgetState(deps: Deps, userId: string): Promise<BudgetState> {
  const b = await deps.db.query.budgets.findFirst({ where: eq(budgets.userId, userId) });
  const now = deps.now();
  const period = b ? currentPeriod(b.period, now, b.periodStart, b.periodEnd) : currentPeriod('monthly', now);
  const spend = await spendForUser(deps, userId, period.start, period.end);
  const amount = b ? Number(b.amount) : null;
  return {
    budget: b ? { amount: amount!, period: b.period, periodStart: b.periodStart, periodEnd: b.periodEnd, assignedBy: b.assignedBy, createdAt: b.createdAt, row: b } : null,
    period,
    spend,
    remaining: amount === null ? null : Math.max(0, amount - spend),
    utilization: amount === null ? null : amount > 0 ? spend / amount : 1,
    blocked: b?.blockedAt !== null && b?.blockedAt !== undefined,
  };
}

function budgetView(s: BudgetState) {
  return s.budget
    ? {
        amount: s.budget.amount,
        period: s.budget.period,
        periodStart: s.budget.periodStart?.toISOString() ?? null,
        periodEnd: s.budget.periodEnd?.toISOString() ?? null,
        assignedBy: s.budget.assignedBy,
        createdAt: s.budget.createdAt.toISOString(),
      }
    : null;
}

export async function getMyBudget(deps: Deps, cu: CurrentUser) {
  return budgetView(await getBudgetState(deps, cu.id));
}

export async function spendSummary(deps: Deps, cu: CurrentUser, month?: string) {
  const state = await getBudgetState(deps, cu.id);
  const p = month ? monthPeriod(month) : state.period;
  const spend = month ? await spendForUser(deps, cu.id, p.start, p.end) : state.spend;
  const amount = state.budget?.amount ?? null;
  const bd = await breakdown(deps, { userId: cu.id }, p.start, p.end);
  return {
    month: month ?? monthKey(p.start),
    periodStart: p.start.toISOString(),
    periodEnd: p.end.toISOString(),
    budget: budgetView(state),
    spend,
    remaining: amount === null ? null : Math.max(0, amount - spend),
    utilization: amount === null ? null : amount > 0 ? spend / amount : 1,
    blocked: state.blocked,
    ...bd,
    history: await monthlyHistory(deps, { userId: cu.id }),
  };
}

export async function setUserBudget(
  deps: Deps,
  actor: CurrentUser,
  userId: string,
  input: { amount: number; period: BudgetPeriod; periodStart?: string | null; periodEnd?: string | null },
) {
  const u = await deps.db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u) throw notFound('User');
  const values = {
    userId,
    amount: String(input.amount),
    period: input.period,
    periodStart: input.periodStart ? new Date(input.periodStart) : null,
    periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
    assignedBy: actor.id,
    updatedAt: deps.now(),
  };
  await deps.db
    .insert(budgets)
    .values(values)
    .onConflictDoUpdate({ target: budgets.userId, set: { ...values, notified80At: null, notified100At: null } });
  try {
    await deps.litellm.updateUserBudget(userId, { maxBudget: input.amount, budgetDuration: budgetDurationFor(input.period) });
  } catch (e) {
    await auditError(deps, { action: 'litellm.update_user_budget', entity: 'user', entityId: userId, err: e, actorId: actor.id });
  }
  await audit(deps, { actorId: actor.id, action: 'budget.set', entity: 'user', entityId: userId, payload: input });
  await evaluateUserBudget(deps, userId);
  return budgetView(await getBudgetState(deps, userId));
}

export async function adminBudgets(deps: Deps, q: { costCenterId?: string; month?: string; page: number; pageSize: number }) {
  const where = and(isNull(user.deletedAt), q.costCenterId ? eq(user.costCenterId, q.costCenterId) : undefined);
  const [{ total } = { total: 0 }] = await deps.db.select({ total: count() }).from(user).where(where);
  const rows = await deps.db.query.user.findMany({ where, orderBy: [desc(user.createdAt)], limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  const items = [];
  for (const u of rows) {
    const s = await getBudgetState(deps, u.id);
    const cc = u.costCenterId ? await deps.db.query.costCenters.findFirst({ where: eq(costCenters.id, u.costCenterId) }) : null;
    const spend = q.month ? await spendForUser(deps, u.id, monthPeriod(q.month).start, monthPeriod(q.month).end) : s.spend;
    items.push({
      user: { id: u.id, name: u.name, email: u.email },
      costCenter: { id: cc?.id ?? '', number: cc?.number ?? '', name: cc?.name ?? '' },
      budget: budgetView(s),
      spend,
      utilization: s.budget ? (s.budget.amount > 0 ? spend / s.budget.amount : 1) : null,
      blocked: s.blocked,
    });
  }
  return { items, total: Number(total), page: q.page, pageSize: q.pageSize };
}

/** F-BUD-5 / F-BUD-1a: warn at 80 %, block keys at 100 %, unblock on new period or raised budget. */
export async function evaluateUserBudget(deps: Deps, userId: string) {
  const s = await getBudgetState(deps, userId);
  if (!s.budget) return;
  const b = s.budget.row;
  const vars = { spend: s.spend.toFixed(2), budget: s.budget.amount.toFixed(2), percent: Math.round((s.utilization ?? 0) * 100) };
  const inPeriod = (d: Date | null) => d !== null && d >= s.period.start && d < s.period.end;
  if ((s.utilization ?? 0) >= 1) {
    if (!b.blockedAt) {
      await deps.db.update(budgets).set({ blockedAt: deps.now(), notified100At: deps.now() }).where(eq(budgets.userId, userId));
      await blockAllKeysOfUser(deps, userId, 'user_budget');
      await notifyUser(deps, userId, 'user_budget_100', vars);
      await audit(deps, { actorId: null, action: 'budget.block', entity: 'user', entityId: userId, payload: vars, severity: 'warning' });
    }
    return;
  }
  if (b.blockedAt) {
    await deps.db.update(budgets).set({ blockedAt: null, notified100At: null }).where(eq(budgets.userId, userId));
    await unblockKeysOfUser(deps, userId, ['user_budget']);
    await audit(deps, { actorId: null, action: 'budget.unblock', entity: 'user', entityId: userId });
  }
  if ((s.utilization ?? 0) >= deps.env.BUDGET_WARN_THRESHOLD && !inPeriod(b.notified80At)) {
    await deps.db.update(budgets).set({ notified80At: deps.now() }).where(eq(budgets.userId, userId));
    await notifyUser(deps, userId, 'user_budget_80', vars);
    await audit(deps, { actorId: null, action: 'budget.warn', entity: 'user', entityId: userId, payload: vars, severity: 'warning' });
  }
}
