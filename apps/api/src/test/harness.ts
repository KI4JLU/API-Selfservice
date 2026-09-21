import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { z } from 'zod';
import { expect } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { apiKeys, eq, notifications, schema, sql, and, type Db } from '@litelite/db';
import { seedBase } from '@litelite/db/seed';
import { CostCenterSchema, type NotificationType } from '@litelite/shared';
import { loadEnv } from '../env.js';
import { createApp } from '../app.js';
import { createMockAdapter } from '../litellm/mock.js';
import { createMemoryMailer } from '../mail/mailer.js';
import type { Deps } from '../context.js';
import type { LiteLLMSpendLog } from '../litellm/types.js';
import { runIngestAndBudgets } from '../jobs/index.js';
import { storeLogs } from '../services/spend.js';

export const TEST_SCHEMA = 'litelite_test';
export const APP_URL = 'http://localhost:5173';
export const API_URL = 'http://localhost:3030';
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://litelite:litelite@localhost:5433/litellm';
/** Fixed "now" so month boundaries never interfere with the tests. */
export const BASE_NOW = new Date('2026-09-15T12:00:00.000Z');
export const DAY = 86_400_000;

if (process.env.DB_SCHEMA !== TEST_SCHEMA) {
  throw new Error(`DB_SCHEMA must be ${TEST_SCHEMA} for tests (got ${process.env.DB_SCHEMA})`);
}

export type Mock = ReturnType<typeof createMockAdapter>;
export type Mailer = ReturnType<typeof createMemoryMailer>;

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export interface ReqOpts {
  /** Origin header; `null` sends none. Defaults to APP_URL. */
  origin?: string | null;
  headers?: Record<string, string>;
}

export interface Client {
  userId: string;
  email: string;
  cookie: string;
  get<T = any>(path: string, opts?: ReqOpts): Promise<Res<T>>;
  post<T = any>(path: string, body?: unknown, opts?: ReqOpts): Promise<Res<T>>;
  put<T = any>(path: string, body?: unknown, opts?: ReqOpts): Promise<Res<T>>;
  patch<T = any>(path: string, body?: unknown, opts?: ReqOpts): Promise<Res<T>>;
  delete<T = any>(path: string, body?: unknown, opts?: ReqOpts): Promise<Res<T>>;
}

export interface LoginOpts {
  email?: string;
  name?: string;
  admin?: boolean;
  affiliation?: string[];
}

export interface TestApp {
  deps: Deps;
  db: Db;
  mock: Mock;
  mailer: Mailer;
  clock: { now: Date };
  /** Raw request against the Hono app. `path` may be absolute or relative to the API root. */
  request(method: string, path: string, init?: { body?: unknown; cookie?: string } & ReqOpts): Promise<Res>;
  /** Dev-login (creates the user on first call) and return a cookie-carrying client. */
  login(opts?: LoginOpts): Promise<Client>;
  /** Client without a session cookie. */
  anonymous(): Client;
  /** Notifications logged in the DB for a type (optionally filtered by recipient). */
  notificationsOf(type: NotificationType, recipient?: string): Promise<{ recipient: string; subject: string; status: string }[]>;
  litellmKeyIdOf(keyId: string): Promise<string>;
  keyRow(keyId: string): Promise<typeof apiKeys.$inferSelect>;
  /** Injects a synthetic LiteLLM spend log for a LiteLite key id (default startTime: 1 min ago). */
  addLog(keyId: string, partial?: Partial<LiteLLMSpendLog>): Promise<LiteLLMSpendLog>;
  /** Writes logs straight into the DB (bypasses the ingest window; e.g. for history / older months). */
  storeLogs(logs: LiteLLMSpendLog[]): Promise<number>;
  /** runIngestAndBudgets(deps) */
  ingest(): Promise<{ fetched: number; inserted: number }>;
  /** `minutes` before the current (fake) clock, as ISO string. */
  ago(minutes: number): string;
  close(): Promise<void>;
}

export const uniq = () => randomUUID().slice(0, 8);
export const uniqEmail = (prefix = 'u') => `${prefix}-${uniq()}@test.local`;

/** Truncates every table of the test schema and re-seeds the default cost center. */
export async function resetDb(db: Db) {
  const res = await db.execute(
    sql.raw(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${TEST_SCHEMA}' AND table_type = 'BASE TABLE' AND table_name <> '__migrations'`),
  );
  const tables = res.rows.map((r) => `"${TEST_SCHEMA}"."${(r as { table_name: string }).table_name}"`);
  if (tables.length) await db.execute(sql.raw(`TRUNCATE TABLE ${tables.join(', ')} CASCADE`));
  await seedBase(db);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Like createDb(), but with a pre-warmed pool that never drops idle connections: Docker Desktop's port
 * forwarding occasionally resets *new* connections (ECONNRESET), established ones are stable.
 */
export async function createTestDb(max = 5): Promise<{ db: Db; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max, idleTimeoutMillis: 0 });
  pool.on('error', () => {
    /* idle client errors are handled by reconnecting on the next query */
  });
  pg.types.setTypeParser(1700, (v) => Number(v));
  const clients: pg.PoolClient[] = [];
  for (let i = 0; i < max; i++) {
    for (let attempt = 0; ; attempt++) {
      try {
        clients.push(await pool.connect());
        break;
      } catch (e) {
        if (attempt >= 7) throw e;
        await sleep(250 * (attempt + 1));
      }
    }
  }
  for (const c of clients) c.release();
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

export async function createTestApp(overrides: Partial<Record<string, string>> = {}): Promise<TestApp> {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL,
    DB_SCHEMA: TEST_SCHEMA,
    AUTH_SECRET: 'x'.repeat(32),
    APP_URL,
    API_URL,
    DEV_LOGIN_ENABLED: 'true',
    LITELLM_MODE: 'mock',
    JOBS_ENABLED: 'false',
    KEYCLOAK_AFFILIATION_VALID: 'member,staff',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
  const { db, close } = await createTestDb();
  await resetDb(db);
  const clock = { now: new Date(BASE_NOW) };
  const now = () => new Date(clock.now);
  const mock = createMockAdapter({ now });
  const mailer = createMemoryMailer();
  const deps: Deps = { env, db, litellm: mock, mailer, log: pino({ level: 'silent' }), now };
  const { app } = createApp(deps);

  const toUrl = (path: string) => (path.startsWith('http') ? path : `${API_URL}${path}`);

  async function request(method: string, path: string, init: { body?: unknown; cookie?: string } & ReqOpts = {}): Promise<Res> {
    const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.origin !== null) headers.origin = init.origin ?? APP_URL;
    if (init.cookie) headers.cookie = init.cookie;
    const res = await app.request(toUrl(path), { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body (e.g. HTML docs) */
    }
    return { status: res.status, body, headers: res.headers };
  }

  const v1 = (path: string) => (path.startsWith('/api/') || path.startsWith('/health') ? path : `/api/v1${path}`);

  function clientFor(cookie: string, userId: string, email: string): Client {
    const call = (method: string) => (path: string, body?: unknown, opts?: ReqOpts) => request(method, v1(path), { body, cookie, ...opts });
    return {
      userId,
      email,
      cookie,
      get: (path, opts) => request('GET', v1(path), { cookie, ...opts }),
      post: call('POST'),
      put: call('PUT'),
      patch: call('PATCH'),
      delete: call('DELETE'),
    };
  }

  async function login(opts: LoginOpts = {}): Promise<Client> {
    const email = opts.email ?? uniqEmail(opts.admin ? 'admin' : 'user');
    const res = await app.request(`${API_URL}/api/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ email, name: opts.name, admin: opts.admin, affiliation: opts.affiliation }),
    });
    const body = (await res.json()) as { ok?: boolean; userId?: string; message?: string };
    if (res.status !== 200 || !body.userId) throw new Error(`dev-login failed: ${res.status} ${JSON.stringify(body)}`);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0]!)
      .join('; ');
    if (!cookie) throw new Error('dev-login returned no Set-Cookie');
    return clientFor(cookie, body.userId, email);
  }

  async function keyRow(keyId: string) {
    const k = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, keyId) });
    if (!k) throw new Error(`key ${keyId} not in DB`);
    return k;
  }
  const litellmKeyIdOf = async (keyId: string) => (await keyRow(keyId)).litellmKeyId;
  const ago = (minutes: number) => new Date(clock.now.getTime() - minutes * 60_000).toISOString();

  return {
    deps,
    db,
    mock,
    mailer,
    clock,
    request,
    login,
    anonymous: () => clientFor('', '', ''),
    async notificationsOf(type, recipient) {
      const rows = await db.query.notifications.findMany({
        where: and(eq(notifications.type, type), recipient ? eq(notifications.recipient, recipient) : undefined),
      });
      return rows.map((r) => ({ recipient: r.recipient, subject: r.subject, status: r.status }));
    },
    keyRow,
    litellmKeyIdOf,
    async addLog(keyId, partial = {}) {
      const litellmKeyId = await litellmKeyIdOf(keyId);
      return mock.addLog({ startTime: ago(1), promptTokens: 100, completionTokens: 50, ...partial, apiKey: litellmKeyId });
    },
    storeLogs: (logs) => storeLogs(deps, logs),
    ingest: () => runIngestAndBudgets(deps),
    ago,
    close,
  };
}

/** Asserts the body matches the schema and carries no fields beyond it (Zod strips unknown keys). */
export function expectShape<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`schema mismatch: ${JSON.stringify(parsed.error.issues, null, 1)}\nbody: ${JSON.stringify(body)}`);
  expect(parsed.data, 'response contains fields beyond the schema').toEqual(body);
  return parsed.data;
}

export function expectError(res: Res, status: number, code: string) {
  expect({ status: res.status, code: res.body?.code }, JSON.stringify(res.body)).toEqual({ status, code });
}

/** Convenience: user with an approved (non-default) cost center. */
export async function approvedCostCenterFor(t: TestApp, admin: Client, user: Client, number = randomCostCenter()) {
  const r = await user.patch('/me', { costCenterNumber: number });
  if (r.status !== 200) throw new Error(`request cost center failed: ${JSON.stringify(r.body)}`);
  const pending = await admin.get('/cost-center-requests?status=pending');
  const req = (pending.body.items as { id: string; user: { id: string } }[]).find((x) => x.user.id === user.userId);
  if (!req) throw new Error('pending request not found');
  const a = await admin.post(`/cost-center-requests/${req.id}/approve`);
  if (a.status !== 200) throw new Error(`approve failed: ${JSON.stringify(a.body)}`);
  return { id: a.body.costCenter.id as string, number };
}

export function randomCostCenter() {
  // 8 digits, never the default 11111111
  return `2${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
}

/** Sync models from the mock and make `freeModel` free. Returns admin provider list. */
export async function syncProvidersWithFree(admin: Client, freeModel = 'gemma-local') {
  const s = await admin.post('/admin/providers/sync');
  if (s.status !== 200) throw new Error(`sync failed: ${JSON.stringify(s.body)}`);
  const list = await admin.get('/admin/providers');
  const free = (list.body as { id: string; modelName: string }[]).find((p) => p.modelName === freeModel);
  if (!free) throw new Error('free model not found');
  const u = await admin.patch(`/admin/providers/${free.id}`, { tier: 'free' });
  if (u.status !== 200) throw new Error(`set free failed: ${JSON.stringify(u.body)}`);
  return (await admin.get('/admin/providers')).body as { id: string; modelName: string; tier: string }[];
}

/**
 * KNOWN BUG (reported, not fixed here): the seeded default cost center has ownerEmail `noreply@localhost`,
 * which fails the shared CostCenterSchema (`z.string().email()`), i.e. the API returns a body that does not
 * satisfy its own OpenAPI contract. Tests use this lenient variant; see cost-centers.test.ts for the failing case.
 */
export const CostCenterSchemaLenient = CostCenterSchema.extend({ ownerEmail: z.string() });

export { BASE_NOW as NOW };
