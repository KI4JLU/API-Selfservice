import { and, apiKeys, auditLog, count, desc, eq, gte, inArray, lt, notLike, or, sql, user } from '@api-selfservice/db';
import type { CostCenterEventCategory } from '@api-selfservice/shared';
import type { Deps } from '../context.js';
import { getCostCenter } from './cost-centers.js';

/** #13: category per cost center action; key events are "keys" (key blocks for budgets: "limits"), other actions are left out. */
const BY_ACTION: Record<string, CostCenterEventCategory> = {
  'cost_center.warn': 'limits',
  'cost_center.block': 'limits',
  'cost_center.unblock': 'limits',
  'cost_center.request': 'requests',
  'cost_center.approve': 'requests',
  'cost_center.reject': 'requests',
  'cost_center.join_request': 'requests',
  'cost_center.join_approve': 'requests',
  'cost_center.join_reject': 'requests',
  'cost_center.create': 'membership',
  'cost_center.archive': 'membership',
  'cost_center.member_add': 'membership',
  'cost_center.member_remove': 'membership',
  'cost_center.member_role': 'membership',
  'cost_center.update': 'budget',
  'cost_center.resync': 'budget',
};

type Query = { page: number; pageSize: number; category?: CostCenterEventCategory; warningsOnly?: boolean; q?: string; from?: string; to?: string };

/**
 * #13: event log of one cost center for its cost center admins: changes to the cost center and its members,
 * join requests, its keys and budget limits. Technical LiteLLM errors (`litellm.*`) stay in the admin log.
 */
export async function listCostCenterEvents(deps: Deps, costCenterId: string, q: Query) {
  const cc = await getCostCenter(deps, costCenterId);
  // Category, filters, counts and paging run in SQL, so the log has no size limit and counts stay exact.
  const byCategory = (c: CostCenterEventCategory) =>
    Object.entries(BY_ACTION)
      .filter(([, v]) => v === c)
      .map(([a]) => a);
  const inList = (actions: string[]) =>
    sql.join(
      actions.map((a) => sql`${a}`),
      sql`, `,
    );
  const budgetKeyBlock = sql`(${auditLog.entity} = 'api_key' and ${auditLog.action} = 'key.block' and coalesce(${auditLog.payload} ->> 'reason', '') ilike '%budget%')`;
  const category = sql<CostCenterEventCategory | null>`case
    when ${budgetKeyBlock} then 'limits'
    when ${auditLog.entity} = 'api_key' then 'keys'
    when ${auditLog.action} in (${inList(byCategory('limits'))}) then 'limits'
    when ${auditLog.action} in (${inList(byCategory('requests'))}) then 'requests'
    when ${auditLog.action} in (${inList(byCategory('membership'))}) then 'membership'
    when ${auditLog.action} in (${inList(byCategory('budget'))}) then 'budget'
  end`;
  // the person an event is about: the member or requester in the payload, the key owner, else the actor (own join request)
  const subjectId = sql<string | null>`coalesce(
    ${auditLog.payload} ->> 'userId',
    (select ${apiKeys.userId} from ${apiKeys} where ${apiKeys.id} = ${auditLog.entityId} and ${auditLog.entity} = 'api_key'),
    case when ${auditLog.action} = 'cost_center.join_request' then ${auditLog.actorId} end
  )`;
  const needle = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null;
  const base = and(
    or(
      and(eq(auditLog.entity, 'cost_center'), eq(auditLog.entityId, cc.id)),
      and(eq(auditLog.entity, 'api_key'), sql`${auditLog.entityId} in (select ${apiKeys.id} from ${apiKeys} where ${apiKeys.costCenterId} = ${cc.id})`),
    ),
    notLike(auditLog.action, 'litellm.%'),
    sql`${category} is not null`,
    q.from ? gte(auditLog.createdAt, new Date(q.from)) : undefined,
    q.to ? lt(auditLog.createdAt, new Date(q.to)) : undefined,
    needle
      ? or(
          sql`exists (select 1 from ${user} where ${user.id} in (${auditLog.actorId}, ${subjectId}) and (${user.name} ilike ${needle} or ${user.email} ilike ${needle}))`,
          sql`(${auditLog.entity} = 'api_key' and exists (select 1 from ${apiKeys} where ${apiKeys.id} = ${auditLog.entityId} and ${apiKeys.name} ilike ${needle}))`,
        )
      : undefined,
  );
  const perCategory = await deps.db
    .select({ category, n: count(), warnings: sql<number>`count(*) filter (where ${auditLog.severity} <> 'info')` })
    .from(auditLog)
    .where(base)
    // by position: the same CASE in SELECT and GROUP BY gets different bind parameters
    .groupBy(sql`1`);
  const counts = { all: 0, warnings: 0, limits: 0, requests: 0, membership: 0, keys: 0, budget: 0 };
  for (const r of perCategory) {
    counts[r.category!] = Number(r.n);
    counts.all += Number(r.n);
    counts.warnings += Number(r.warnings);
  }
  const where = and(base, q.category ? sql`${category} = ${q.category}` : undefined, q.warningsOnly ? sql`${auditLog.severity} <> 'info'` : undefined);
  const [{ total } = { total: 0 }] = await deps.db.select({ total: count() }).from(auditLog).where(where);
  const rows = await deps.db
    .select({ r: auditLog, category, subjectId })
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);

  const keyIds = [...new Set(rows.filter((x) => x.r.entity === 'api_key' && x.r.entityId).map((x) => x.r.entityId!))];
  const keys = keyIds.length ? await deps.db.query.apiKeys.findMany({ where: inArray(apiKeys.id, keyIds), columns: { id: true, name: true } }) : [];
  const userIds = [...new Set(rows.flatMap((x) => [x.r.actorId, x.subjectId]).filter((v): v is string => !!v))];
  const users = userIds.length ? await deps.db.query.user.findMany({ where: inArray(user.id, userIds), columns: { id: true, name: true, email: true } }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const payloadOf = (p: unknown) => (p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null);

  const items = rows.map(({ r, category: cat, subjectId: sid }) => {
    const actor = r.actorId ? userById.get(r.actorId) : undefined;
    const subject = sid ? userById.get(sid) : undefined;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      severity: r.severity,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      entityLabel: r.entity === 'api_key' ? (keys.find((k) => k.id === r.entityId)?.name ?? null) : `${cc.number} ${cc.name}`,
      actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : null,
      payload: payloadOf(r.payload),
      category: cat!,
      subject: subject ? { id: subject.id, name: subject.name, email: subject.email } : null,
    };
  });
  return { items, total: Number(total), page: q.page, pageSize: q.pageSize, counts };
}
