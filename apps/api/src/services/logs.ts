import { and, count, desc, eq, gte, lte, requestLogs, apiKeys } from '@litelite/db';
import type { Deps } from '../context.js';

export async function listLogs(
  deps: Deps,
  userId: string,
  q: { from?: string; to?: string; model?: string; keyId?: string; status?: 'success' | 'failure'; requestId?: string; page: number; pageSize: number },
) {
  const where = and(
    eq(requestLogs.userId, userId),
    q.from ? gte(requestLogs.time, new Date(q.from)) : undefined,
    q.to ? lte(requestLogs.time, new Date(q.to)) : undefined,
    q.model ? eq(requestLogs.model, q.model) : undefined,
    q.keyId ? eq(requestLogs.apiKeyId, q.keyId) : undefined,
    q.status ? eq(requestLogs.status, q.status) : undefined,
    q.requestId ? eq(requestLogs.requestId, q.requestId) : undefined,
  );
  const [{ total } = { total: 0 }] = await deps.db.select({ total: count() }).from(requestLogs).where(where);
  const rows = await deps.db
    .select({ l: requestLogs, keyName: apiKeys.name })
    .from(requestLogs)
    .leftJoin(apiKeys, eq(apiKeys.id, requestLogs.apiKeyId))
    .where(where)
    .orderBy(desc(requestLogs.time))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return {
    items: rows.map(({ l, keyName }) => ({
      requestId: l.requestId,
      sessionId: l.sessionId,
      time: l.time.toISOString(),
      type: l.type,
      status: l.status,
      model: l.model,
      keyId: l.apiKeyId,
      keyName,
      cost: Number(l.cost),
      durationMs: l.durationMs,
      ttftMs: l.ttftMs,
      tokensIn: l.tokensIn,
      tokensOut: l.tokensOut,
      tags: l.tags,
      error: l.error,
    })),
    total: Number(total),
    page: q.page,
    pageSize: q.pageSize,
  };
}
