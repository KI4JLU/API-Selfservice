import { and, apiKeys, count, desc, eq, gte, jobState, lt, requestLogs, spendSnapshots, sql, sum, user } from '@api-selfservice/db';
import { dateKey } from '@api-selfservice/shared';
import type { Deps } from '../context.js';
import type { LiteLLMSpendLog } from '../litellm/types.js';

const INGEST_KEY = 'ingest:last_time';

/**
 * Pulls spend logs from LiteLLM since the last ingest, maps them to users/keys/cost centers
 * and upserts request_logs + spend_snapshots. Idempotent on request_id.
 */
export async function ingestSpendLogs(deps: Deps, opts: { since?: Date; until?: Date } = {}) {
  const now = deps.now();
  const state = await deps.db.query.jobState.findFirst({ where: eq(jobState.key, INGEST_KEY) });
  const last = opts.since ?? (state?.value && typeof state.value === 'object' && 'time' in state.value ? new Date(String((state.value as { time: string }).time)) : new Date(now.getTime() - 7 * 86400000));
  // Overlap by 10 minutes to catch late writes; request_id dedupes.
  const since = new Date(last.getTime() - 10 * 60000);
  const until = opts.until ?? now;
  const logs = await deps.litellm.getSpendLogs(since, until);
  const inserted = await storeLogs(deps, logs);
  await deps.db
    .insert(jobState)
    .values({ key: INGEST_KEY, value: { time: until.toISOString() }, updatedAt: now })
    .onConflictDoUpdate({ target: jobState.key, set: { value: { time: until.toISOString() }, updatedAt: now } });
  return { fetched: logs.length, inserted };
}

export async function storeLogs(deps: Deps, logs: LiteLLMSpendLog[]) {
  if (!logs.length) return 0;
  const keyRows = await deps.db.query.apiKeys.findMany();
  const byLitellmKey = new Map(keyRows.map((k) => [k.litellmKeyId, k]));
  const byHash = new Map(keyRows.filter((k) => k.keyHash).map((k) => [k.keyHash!, k]));
  const users = await deps.db.query.user.findMany();
  // user ids are shared with LiteLLM (E-7): the log's `user` is the API-Selfservice id
  const byId = new Map(users.map((u) => [u.id, u]));
  let inserted = 0;
  const touched = new Map<string, { date: string; userId: string | null; apiKeyId: string | null; costCenterId: string | null; model: string; provider: string | null }>();

  for (const l of logs) {
    const key = byLitellmKey.get(l.apiKey) ?? byHash.get(l.apiKey);
    const u = key ? byId.get(key.userId) : l.litellmUserId ? byId.get(l.litellmUserId) : undefined;
    const row = {
      requestId: l.requestId,
      sessionId: l.sessionId,
      userId: u?.id ?? null,
      litellmUserId: l.litellmUserId,
      apiKeyId: key?.id ?? null,
      litellmKeyId: l.apiKey || null,
      costCenterId: key?.costCenterId ?? u?.costCenterId ?? null,
      time: new Date(l.startTime),
      endTime: l.endTime ? new Date(l.endTime) : null,
      type: l.callType,
      status: l.status,
      model: l.model,
      provider: l.provider,
      cost: String(l.spend),
      durationMs: l.durationMs === null ? null : Math.round(l.durationMs),
      ttftMs: l.ttftMs === null ? null : Math.round(l.ttftMs),
      tokensIn: l.promptTokens,
      tokensOut: l.completionTokens,
      tags: l.tags,
      error: l.error,
    };
    const res = await deps.db.insert(requestLogs).values(row).onConflictDoNothing().returning({ id: requestLogs.requestId });
    if (res.length) {
      inserted++;
      const date = dateKey(row.time);
      const k = [date, row.userId, row.apiKeyId, row.costCenterId, row.model].join('|');
      touched.set(k, { date, userId: row.userId, apiKeyId: row.apiKeyId, costCenterId: row.costCenterId, model: row.model, provider: row.provider });
    }
  }
  for (const t of touched.values()) await rebuildSnapshot(deps, t);
  return inserted;
}

async function rebuildSnapshot(
  deps: Deps,
  t: { date: string; userId: string | null; apiKeyId: string | null; costCenterId: string | null; model: string; provider: string | null },
) {
  const start = new Date(`${t.date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86400000);
  const nullEq = <C extends { name: string }>(col: C, v: string | null) => (v === null ? sql`${col} IS NULL` : eq(col as never, v));
  const [agg] = await deps.db
    .select({
      spend: sum(requestLogs.cost),
      tokensIn: sum(requestLogs.tokensIn),
      tokensOut: sum(requestLogs.tokensOut),
      n: count(),
      failed: sql<number>`count(*) filter (where ${requestLogs.status} = 'failure')`,
    })
    .from(requestLogs)
    .where(
      and(
        gte(requestLogs.time, start),
        lt(requestLogs.time, end),
        nullEq(requestLogs.userId, t.userId),
        nullEq(requestLogs.apiKeyId, t.apiKeyId),
        nullEq(requestLogs.costCenterId, t.costCenterId),
        eq(requestLogs.model, t.model),
      ),
    );
  const values = {
    date: t.date,
    userId: t.userId,
    apiKeyId: t.apiKeyId,
    costCenterId: t.costCenterId,
    model: t.model,
    provider: t.provider,
    spend: String(Number(agg?.spend ?? 0)),
    tokensIn: Number(agg?.tokensIn ?? 0),
    tokensOut: Number(agg?.tokensOut ?? 0),
    requestCount: Number(agg?.n ?? 0),
    failedCount: Number(agg?.failed ?? 0),
    updatedAt: deps.now(),
  };
  // Unique index has nullable columns; emulate upsert manually.
  await deps.db
    .delete(spendSnapshots)
    .where(
      and(
        eq(spendSnapshots.date, t.date),
        nullEq(spendSnapshots.userId, t.userId),
        nullEq(spendSnapshots.apiKeyId, t.apiKeyId),
        nullEq(spendSnapshots.costCenterId, t.costCenterId),
        eq(spendSnapshots.model, t.model),
      ),
    );
  await deps.db.insert(spendSnapshots).values(values);
}

export async function spendForUser(deps: Deps, userId: string, start: Date, end: Date): Promise<number> {
  const [r] = await deps.db
    .select({ s: sum(requestLogs.cost) })
    .from(requestLogs)
    .where(and(eq(requestLogs.userId, userId), gte(requestLogs.time, start), lt(requestLogs.time, end)));
  return Number(r?.s ?? 0);
}

export async function spendForCostCenter(deps: Deps, costCenterId: string, start: Date, end: Date): Promise<number> {
  const [r] = await deps.db
    .select({ s: sum(requestLogs.cost) })
    .from(requestLogs)
    .where(and(eq(requestLogs.costCenterId, costCenterId), gte(requestLogs.time, start), lt(requestLogs.time, end)));
  return Number(r?.s ?? 0);
}

/** Spend of one key, optionally limited to [start, end) (F-KEY-11: current month for monthly key budgets). */
export async function spendForKey(deps: Deps, apiKeyId: string, range?: { start: Date; end: Date }): Promise<number> {
  const [r] = await deps.db
    .select({ s: sum(requestLogs.cost) })
    .from(requestLogs)
    .where(and(eq(requestLogs.apiKeyId, apiKeyId), range ? gte(requestLogs.time, range.start) : undefined, range ? lt(requestLogs.time, range.end) : undefined));
  return Number(r?.s ?? 0);
}

export interface Breakdown {
  metrics: { totalRequests: number; successfulRequests: number; failedRequests: number; avgCostPerRequest: number; totalTokens: number; tokensIn: number; tokensOut: number };
  daily: { date: string; spend: number; requests: number }[];
  byKey: { keyId: string | null; keyName: string; spend: number; requests: number }[];
  byModel: { model: string; spend: number; requests: number; tokens: number }[];
  byProvider: { provider: string; spend: number; requests: number; tokens: number }[];
}

export async function breakdown(deps: Deps, filter: { userId?: string; costCenterId?: string }, start: Date, end: Date): Promise<Breakdown> {
  const where = and(
    filter.userId ? eq(requestLogs.userId, filter.userId) : undefined,
    filter.costCenterId ? eq(requestLogs.costCenterId, filter.costCenterId) : undefined,
    gte(requestLogs.time, start),
    lt(requestLogs.time, end),
  );
  const [m] = await deps.db
    .select({
      n: count(),
      failed: sql<number>`count(*) filter (where ${requestLogs.status} = 'failure')`,
      spend: sum(requestLogs.cost),
      tin: sum(requestLogs.tokensIn),
      tout: sum(requestLogs.tokensOut),
    })
    .from(requestLogs)
    .where(where);
  const n = Number(m?.n ?? 0);
  const spend = Number(m?.spend ?? 0);
  const daily = await deps.db
    .select({ date: sql<string>`to_char(${requestLogs.time} at time zone 'UTC', 'YYYY-MM-DD')`, spend: sum(requestLogs.cost), n: count() })
    .from(requestLogs)
    .where(where)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const byKey = await deps.db
    .select({ keyId: requestLogs.apiKeyId, keyName: apiKeys.name, spend: sum(requestLogs.cost), n: count() })
    .from(requestLogs)
    .leftJoin(apiKeys, eq(apiKeys.id, requestLogs.apiKeyId))
    .where(where)
    .groupBy(requestLogs.apiKeyId, apiKeys.name)
    .orderBy(desc(sum(requestLogs.cost)))
    .limit(25);
  const byModel = await deps.db
    .select({ model: requestLogs.model, spend: sum(requestLogs.cost), n: count(), tokens: sql<number>`sum(${requestLogs.tokensIn} + ${requestLogs.tokensOut})` })
    .from(requestLogs)
    .where(where)
    .groupBy(requestLogs.model)
    .orderBy(desc(sum(requestLogs.cost)))
    .limit(25);
  const byProvider = await deps.db
    .select({ provider: requestLogs.provider, spend: sum(requestLogs.cost), n: count(), tokens: sql<number>`sum(${requestLogs.tokensIn} + ${requestLogs.tokensOut})` })
    .from(requestLogs)
    .where(where)
    .groupBy(requestLogs.provider)
    .orderBy(desc(sum(requestLogs.cost)));
  return {
    metrics: {
      totalRequests: n,
      successfulRequests: n - Number(m?.failed ?? 0),
      failedRequests: Number(m?.failed ?? 0),
      avgCostPerRequest: n ? spend / n : 0,
      totalTokens: Number(m?.tin ?? 0) + Number(m?.tout ?? 0),
      tokensIn: Number(m?.tin ?? 0),
      tokensOut: Number(m?.tout ?? 0),
    },
    daily: daily.map((d) => ({ date: d.date, spend: Number(d.spend ?? 0), requests: Number(d.n) })),
    byKey: byKey.map((k) => ({ keyId: k.keyId, keyName: k.keyName ?? '(unknown)', spend: Number(k.spend ?? 0), requests: Number(k.n) })),
    byModel: byModel.map((k) => ({ model: k.model, spend: Number(k.spend ?? 0), requests: Number(k.n), tokens: Number(k.tokens ?? 0) })),
    byProvider: byProvider.map((k) => ({ provider: k.provider ?? 'unknown', spend: Number(k.spend ?? 0), requests: Number(k.n), tokens: Number(k.tokens ?? 0) })),
  };
}

export async function monthlyHistory(deps: Deps, filter: { userId?: string; costCenterId?: string }, months = 12) {
  const now = deps.now();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const rows = await deps.db
    .select({ month: sql<string>`to_char(${requestLogs.time} at time zone 'UTC', 'YYYY-MM')`, spend: sum(requestLogs.cost) })
    .from(requestLogs)
    .where(
      and(
        filter.userId ? eq(requestLogs.userId, filter.userId) : undefined,
        filter.costCenterId ? eq(requestLogs.costCenterId, filter.costCenterId) : undefined,
        gte(requestLogs.time, start),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const map = new Map(rows.map((r) => [r.month, Number(r.spend ?? 0)]));
  const out = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ month: key, spend: map.get(key) ?? 0 });
  }
  return out;
}

export { user as _userTable };
