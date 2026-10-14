import { and, apiKeys, auditLog, desc, eq, gte, inArray, lt, notLike, or, user } from '@api-selfservice/db';
import type { CostCenterEventCategory } from '@api-selfservice/shared';
import type { Deps } from '../context.js';
import { getCostCenter } from './cost-centers.js';

/** Upper bound of events read per request; a cost center's log stays far below it. */
const MAX_EVENTS = 2000;

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

/** #13: key events are "keys"; key blocks for budgets count as limits. Unknown cost center actions are left out. */
export function eventCategory(action: string, entity: string, payload: Record<string, unknown> | null): CostCenterEventCategory | null {
  if (entity === 'api_key') return action === 'key.block' && String(payload?.reason ?? '').includes('budget') ? 'limits' : 'keys';
  return BY_ACTION[action] ?? null;
}

type Query = { page: number; pageSize: number; category?: CostCenterEventCategory; warningsOnly?: boolean; q?: string; from?: string; to?: string };

/**
 * #13: event log of one cost center for its cost center admins: changes to the cost center and its members,
 * join requests, its keys and budget limits. Technical LiteLLM errors (`litellm.*`) stay in the admin log.
 */
export async function listCostCenterEvents(deps: Deps, costCenterId: string, q: Query) {
  const cc = await getCostCenter(deps, costCenterId);
  const keys = await deps.db.query.apiKeys.findMany({ where: eq(apiKeys.costCenterId, cc.id), columns: { id: true, name: true, userId: true } });
  const keyById = new Map(keys.map((k) => [k.id, k]));
  const where = and(
    or(and(eq(auditLog.entity, 'cost_center'), eq(auditLog.entityId, cc.id)), keys.length ? and(eq(auditLog.entity, 'api_key'), inArray(auditLog.entityId, [...keyById.keys()])) : undefined),
    notLike(auditLog.action, 'litellm.%'),
    q.from ? gte(auditLog.createdAt, new Date(q.from)) : undefined,
    q.to ? lt(auditLog.createdAt, new Date(q.to)) : undefined,
  );
  const rows = await deps.db.query.auditLog.findMany({ where, orderBy: [desc(auditLog.createdAt), desc(auditLog.id)], limit: MAX_EVENTS });

  const payloadOf = (p: unknown) => (p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null);
  // the person an event is about: the member or requester in the payload, the key owner, else the actor (own join request)
  const subjectIdOf = (r: (typeof rows)[number]) => {
    const p = payloadOf(r.payload);
    if (typeof p?.userId === 'string') return p.userId;
    if (r.entity === 'api_key') return keyById.get(r.entityId ?? '')?.userId ?? null;
    return r.action === 'cost_center.join_request' ? r.actorId : null;
  };
  const userIds = [...new Set(rows.flatMap((r) => [r.actorId, subjectIdOf(r)]).filter((x): x is string => !!x))];
  const users = userIds.length ? await deps.db.query.user.findMany({ where: inArray(user.id, userIds), columns: { id: true, name: true, email: true } }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const all = rows
    .map((r) => {
      const payload = payloadOf(r.payload);
      const category = eventCategory(r.action, r.entity, payload);
      if (!category) return null;
      const actor = r.actorId ? userById.get(r.actorId) : undefined;
      const subjectId = subjectIdOf(r);
      const subject = subjectId ? userById.get(subjectId) : undefined;
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        severity: r.severity,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        entityLabel: r.entity === 'api_key' ? (keyById.get(r.entityId ?? '')?.name ?? null) : `${cc.number} ${cc.name}`,
        actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : null,
        payload,
        category,
        subject: subject ? { id: subject.id, name: subject.name, email: subject.email } : null,
      };
    })
    .filter((e) => e !== null);

  const needle = q.q?.toLowerCase();
  const matching = needle
    ? all.filter((e) => [e.subject?.name, e.subject?.email, e.actor?.name, e.actor?.email, e.entity === 'api_key' ? e.entityLabel : null].some((v) => v?.toLowerCase().includes(needle)))
    : all;
  const warning = (e: (typeof all)[number]) => e.severity !== 'info';
  const counts = {
    all: matching.length,
    warnings: matching.filter(warning).length,
    limits: 0,
    requests: 0,
    membership: 0,
    keys: 0,
    budget: 0,
  };
  for (const e of matching) counts[e.category]++;
  const filtered = matching.filter((e) => (!q.category || e.category === q.category) && (!q.warningsOnly || warning(e)));
  const items = filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  return { items, total: filtered.length, page: q.page, pageSize: q.pageSize, counts };
}
