import { and, apiKeys, auditLog, costCenters, count, desc, eq, gte, ilike, inArray, lt, providers, user } from '@litelite/db';
import type { AuditEntity, AuditSeverity } from '@litelite/shared';
import type { Deps } from '../context.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: AuditEntity;
  entityId?: string | null;
  payload?: unknown;
  /** Defaults to `info`. Use `warning` for alerts (budget exhausted, account invalid). */
  severity?: AuditSeverity;
}

/** Writes one row to the admin event log (audit_log). */
export async function audit(deps: Pick<Deps, 'db'>, entry: AuditEntry) {
  await deps.db.insert(auditLog).values({
    actorId: entry.actorId,
    severity: entry.severity ?? 'info',
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    payload: entry.payload ?? null,
  });
}

function errorInfo(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, ...('status' in err ? { status: (err as { status: unknown }).status } : {}) };
  return { message: String(err) };
}

/**
 * Logs a failure (structured log + event log with severity `error`). Never throws: it is called from
 * error paths, and a broken event log must not mask the original failure.
 */
export async function auditError(
  deps: Pick<Deps, 'db' | 'log'>,
  entry: { action: string; entity: AuditEntity; entityId?: string | null; err: unknown; actorId?: string | null; payload?: Record<string, unknown> },
) {
  deps.log.error({ err: entry.err, action: entry.action, entity: entry.entity, entityId: entry.entityId, ...entry.payload }, entry.action);
  try {
    await audit(deps, {
      actorId: entry.actorId ?? null,
      severity: 'error',
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      payload: { ...entry.payload, error: errorInfo(entry.err) },
    });
  } catch (e) {
    deps.log.error({ err: e }, 'writing the event log failed');
  }
}

export interface EventsQuery {
  page: number;
  pageSize: number;
  severity?: AuditSeverity;
  entity?: AuditEntity;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
}

/** Admin event log, newest first, with actor and a display label per entity. */
export async function listEvents(deps: Pick<Deps, 'db'>, q: EventsQuery) {
  const where = and(
    q.severity ? eq(auditLog.severity, q.severity) : undefined,
    q.entity ? eq(auditLog.entity, q.entity) : undefined,
    q.entityId ? eq(auditLog.entityId, q.entityId) : undefined,
    q.actorId ? eq(auditLog.actorId, q.actorId) : undefined,
    q.action ? ilike(auditLog.action, `%${q.action.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
    q.from ? gte(auditLog.createdAt, new Date(q.from)) : undefined,
    q.to ? lt(auditLog.createdAt, new Date(q.to)) : undefined,
  );
  const [{ total } = { total: 0 }] = await deps.db.select({ total: count() }).from(auditLog).where(where);
  const rows = await deps.db.query.auditLog.findMany({ where, orderBy: [desc(auditLog.createdAt), desc(auditLog.id)], limit: q.pageSize, offset: (q.page - 1) * q.pageSize });

  const idsOf = (entity: AuditEntity) => [...new Set(rows.filter((r) => r.entity === entity && r.entityId).map((r) => r.entityId!))];
  const userIds = [...new Set([...idsOf('user'), ...rows.map((r) => r.actorId).filter((x): x is string => !!x)])];
  const [users, keys, ccs, provs] = await Promise.all([
    userIds.length ? deps.db.query.user.findMany({ where: inArray(user.id, userIds), columns: { id: true, name: true, email: true } }) : [],
    idsOf('api_key').length ? deps.db.query.apiKeys.findMany({ where: inArray(apiKeys.id, idsOf('api_key')), columns: { id: true, name: true } }) : [],
    idsOf('cost_center').length ? deps.db.query.costCenters.findMany({ where: inArray(costCenters.id, idsOf('cost_center')), columns: { id: true, number: true, name: true } }) : [],
    idsOf('provider').length ? deps.db.query.providers.findMany({ where: inArray(providers.id, idsOf('provider')), columns: { id: true, modelName: true } }) : [],
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const labels = new Map<string, string>([
    ...keys.map((k) => [`api_key:${k.id}`, k.name] as const),
    ...ccs.map((c) => [`cost_center:${c.id}`, `${c.number} ${c.name}`] as const),
    ...provs.map((p) => [`provider:${p.id}`, p.modelName] as const),
    ...users.map((u) => [`user:${u.id}`, u.email] as const),
  ]);

  const items = rows.map((r) => {
    const actor = r.actorId ? userById.get(r.actorId) : undefined;
    const payload = r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload) ? (r.payload as Record<string, unknown>) : null;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      severity: r.severity,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      entityLabel: r.entityId ? (labels.get(`${r.entity}:${r.entityId}`) ?? (r.entity === 'job' || r.entity === 'request' ? r.entityId : null)) : null,
      actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : null,
      payload,
    };
  });
  return { items, total: Number(total), page: q.page, pageSize: q.pageSize };
}
