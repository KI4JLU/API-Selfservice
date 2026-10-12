import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { API_URL, LIVE_MODEL, ORIGIN, RUN } from './env';
import { created, TEAM_ADMIN_ROLE } from './litellm-admin';

export interface LiveUser {
  api: APIRequestContext;
  id: string;
  email: string;
  name: string;
}

let seq = 0;

/** Fresh user per call via dev login (own cookie jar); signing in creates the LiteLLM user, which is recorded for cleanup. */
export async function liveUser(role: string, opts: { admin?: boolean } = {}): Promise<LiveUser> {
  seq += 1;
  const email = `test-${RUN}-${role}-${seq}@example.com`;
  const name = `Test ${role} ${RUN}`;
  const api = await playwrightRequest.newContext({ baseURL: API_URL, extraHTTPHeaders: { Origin: ORIGIN } });
  const login = await api.post('/api/auth/dev-login', { data: { email, name, admin: opts.admin } });
  expect(login.status(), await login.text()).toBe(200);
  const { userId } = (await login.json()) as { userId: string };
  created.users.add(userId);
  // the first authenticated call makes sure the LiteLLM user exists
  expect((await api.get('/api/v1/me')).status()).toBe(200);
  return { api, id: userId, email, name };
}

/** Signs the same user in again (new session, e.g. after reactivation). */
export async function relogin(u: LiveUser): Promise<LiveUser> {
  await u.api.dispose();
  const api = await playwrightRequest.newContext({ baseURL: API_URL, extraHTTPHeaders: { Origin: ORIGIN } });
  const login = await api.post('/api/auth/dev-login', { data: { email: u.email, name: u.name } });
  expect(login.status(), await login.text()).toBe(200);
  return { ...u, api };
}

/** Regex source for a cost center number in mail subjects, which show it grouped as "1234 5678". */
export const ccPattern = (n: string) => `${n.slice(0, 4)} ?${n.slice(4)}`;

/** Without LiteLLM Enterprise a cost center admin is only a LiteLLM team member; the event log must warn about it. */
export async function expectTeamAdminWarning(admin: APIRequestContext, costCenterId: string, userId: string) {
  if (TEAM_ADMIN_ROLE === 'admin') return;
  await expect
    .poll(
      async () => {
        const events = await json<{ items: { severity: string; payload: { userId?: string } }[] }>(
          admin.get(`/api/v1/admin/events?action=litellm.team_admin_downgraded&entityId=${costCenterId}&pageSize=200`),
        );
        return events.items.some((e) => e.severity === 'warning' && e.payload?.userId === userId);
      },
      { message: `event log warning for team admin ${userId}` },
    )
    .toBe(true);
}

export function uniqueCostCenterNumber() {
  // 8 digits starting with 9, never the default 11111111
  return `9${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
}

export async function json<T = any>(res: Promise<import('@playwright/test').APIResponse> | import('@playwright/test').APIResponse, status = 200): Promise<T> {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  return (await r.json()) as T;
}

export async function expectError(res: Promise<import('@playwright/test').APIResponse>, status: number, code?: string) {
  const r = await res;
  expect(r.status(), await r.text()).toBe(status);
  if (code) expect(((await r.json()) as { code: string }).code).toBe(code);
}

const NOT_CHAT = /embed|whisper|tts|dall-e|image|rerank|moderation|audio|transcri|realtime|search/i;

/**
 * Chat model with a price, so one request creates real spend (plan decision c).
 * E2E_LIVE_MODEL wins; otherwise the cheapest priced chat model from the provider sync.
 */
export async function pickPricedModel(admin: APIRequestContext): Promise<string> {
  await json(admin.post('/api/v1/admin/providers/sync'));
  const providers = await json<{ modelName: string; available: boolean; inputCostPerToken: number | null; outputCostPerToken: number | null }[]>(admin.get('/api/v1/admin/providers'));
  if (LIVE_MODEL) {
    expect(
      providers.map((p) => p.modelName),
      `E2E_LIVE_MODEL ${LIVE_MODEL} not in LiteLLM`,
    ).toContain(LIVE_MODEL);
    return LIVE_MODEL;
  }
  const priced = providers
    .filter((p) => p.available && !NOT_CHAT.test(p.modelName) && (p.inputCostPerToken ?? 0) > 0)
    .sort((a, b) => (a.inputCostPerToken ?? 0) + (a.outputCostPerToken ?? 0) - ((b.inputCostPerToken ?? 0) + (b.outputCostPerToken ?? 0)));
  expect(priced.length, 'no priced chat model in LiteLLM; set E2E_LIVE_MODEL').toBeGreaterThan(0);
  return priced[0]!.modelName;
}

/** Creates a key and records its secret for cleanup. */
export async function createKey(u: LiveUser, data: { costCenterId: string; models: string[]; budget?: number | null }) {
  const key = await json<{ id: string; secret: string; status: string }>(u.api.post('/api/v1/api-keys', { data: { name: `test ${RUN}`, ...data } }), 201);
  created.keys.add(key.secret);
  return key;
}

export async function keyStatus(u: LiveUser, keyId: string) {
  const list = await json<{ items: { id: string; status: string }[] }>(u.api.get('/api/v1/api-keys'));
  return list.items.find((k) => k.id === keyId)?.status ?? null;
}

/**
 * Runs the ingest job until `done` holds. LiteLLM writes spend logs in batches, so a real request
 * can take a minute or two to show up.
 */
export async function ingestUntil(admin: APIRequestContext, done: () => Promise<boolean>, timeout = 240_000) {
  await expect
    .poll(
      async () => {
        await json(admin.post('/api/v1/admin/jobs/ingest'));
        return done();
      },
      { timeout, intervals: [5_000, 10_000, 15_000] },
    )
    .toBe(true);
}
