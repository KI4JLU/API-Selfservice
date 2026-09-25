import { and, apiKeys, costCenters, count, eq, gte, lt, ne, requestLogs, sum, user } from '@api-selfservice/db';
import type { CurrentUser, Deps } from '../context.js';
import { forbidden, notFound } from '../errors.js';
import { costCenterPeriod } from './cost-centers.js';

function range(deps: Deps, q: { from?: string; to?: string }, cc?: typeof costCenters.$inferSelect) {
  if (q.from || q.to) {
    const start = q.from ? new Date(`${q.from}T00:00:00.000Z`) : new Date(0);
    const end = q.to ? new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86400000) : deps.now();
    return { start, end };
  }
  return cc ? costCenterPeriod(cc, deps.now()) : costCenterPeriod({ budgetPeriod: 'monthly', periodStart: null, periodEnd: null } as never, deps.now());
}

async function rowFor(deps: Deps, cc: typeof costCenters.$inferSelect, start: Date, end: Date) {
  const where = and(eq(requestLogs.costCenterId, cc.id), gte(requestLogs.time, start), lt(requestLogs.time, end));
  const [agg] = await deps.db.select({ spend: sum(requestLogs.cost), n: count() }).from(requestLogs).where(where);
  const [{ users } = { users: 0 }] = await deps.db.select({ users: count() }).from(user).where(eq(user.costCenterId, cc.id));
  const [{ keys } = { keys: 0 }] = await deps.db.select({ keys: count() }).from(apiKeys).where(and(eq(apiKeys.costCenterId, cc.id), ne(apiKeys.status, 'deleted')));
  const spend = Number(agg?.spend ?? 0);
  const budget = cc.maxBudget === null ? null : Number(cc.maxBudget);
  return {
    costCenter: { id: cc.id, number: cc.number, name: cc.name, ownerName: cc.ownerName, ownerEmail: cc.ownerEmail },
    budget,
    spend,
    remaining: budget === null ? null : Math.max(0, budget - spend),
    utilization: budget === null ? null : budget > 0 ? spend / budget : 1,
    userCount: Number(users),
    keyCount: Number(keys),
    requests: Number(agg?.n ?? 0),
  };
}

export async function costCenterReport(deps: Deps, cu: CurrentUser, q: { from?: string; to?: string }) {
  const all = await deps.db.query.costCenters.findMany({ where: ne(costCenters.status, 'rejected'), orderBy: [costCenters.number] });
  const visible = cu.role === 'admin' ? all : all.filter((c) => cu.managedCostCenterIds.includes(c.id));
  const rows = [];
  for (const cc of visible) {
    const { start, end } = range(deps, q, cc);
    rows.push(await rowFor(deps, cc, start, end));
  }
  return rows;
}

export async function costCenterReportDetail(deps: Deps, cu: CurrentUser, id: string, q: { from?: string; to?: string }) {
  const cc = await deps.db.query.costCenters.findFirst({ where: eq(costCenters.id, id) });
  if (!cc) throw notFound('Cost center');
  if (cu.role !== 'admin' && !cu.managedCostCenterIds.includes(id)) throw forbidden();
  const { start, end } = range(deps, q, cc);
  const summary = await rowFor(deps, cc, start, end);
  const where = and(eq(requestLogs.costCenterId, cc.id), gte(requestLogs.time, start), lt(requestLogs.time, end));
  const perUser = await deps.db
    .select({ userId: requestLogs.userId, name: user.name, email: user.email, spend: sum(requestLogs.cost), n: count() })
    .from(requestLogs)
    .leftJoin(user, eq(user.id, requestLogs.userId))
    .where(where)
    .groupBy(requestLogs.userId, user.name, user.email);
  const perKey = await deps.db
    .select({ userId: requestLogs.userId, keyId: requestLogs.apiKeyId, keyName: apiKeys.name, spend: sum(requestLogs.cost), n: count() })
    .from(requestLogs)
    .leftJoin(apiKeys, eq(apiKeys.id, requestLogs.apiKeyId))
    .where(where)
    .groupBy(requestLogs.userId, requestLogs.apiKeyId, apiKeys.name);
  return {
    summary,
    users: perUser.map((u) => ({
      user: { id: u.userId ?? '', name: u.name ?? '(unknown)', email: u.email ?? '' },
      spend: Number(u.spend ?? 0),
      requests: Number(u.n),
      keys: perKey
        .filter((k) => k.userId === u.userId)
        .map((k) => ({ keyId: k.keyId, keyName: k.keyName ?? '(unknown)', spend: Number(k.spend ?? 0), requests: Number(k.n) })),
    })),
  };
}
