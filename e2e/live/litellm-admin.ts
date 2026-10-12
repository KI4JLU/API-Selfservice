import { LITELLM_API_KEY, LITELLM_BASE_URL } from './env';

/**
 * Direct calls to the LiteLLM proxy with the master key: checks that API-Selfservice really synced
 * teams, members, budgets and blocks, and removes everything this run created.
 */

type Raw = Record<string, unknown>;

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, token = LITELLM_API_KEY): Promise<{ status: number; json: T }> {
  const res = await fetch(`${LITELLM_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // keep the text
  }
  return { status: res.status, json: json as T };
}

async function ok<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await call<T>(method, path, body);
  if (r.status >= 400) throw new Error(`LiteLLM ${path} -> ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

export interface LiveTeam {
  teamId: string;
  alias: string | null;
  maxBudget: number | null;
  budgetDuration: string | null;
  blocked: boolean;
  members: { userId: string; role: string }[];
  metadata: Raw;
}

export async function getTeam(teamId: string): Promise<LiveTeam | null> {
  const r = await call<{ team_info?: Raw }>('GET', `/team/info?team_id=${encodeURIComponent(teamId)}`);
  if (r.status === 404 || r.status === 400 || !r.json?.team_info) return null;
  if (r.status >= 400) throw new Error(`LiteLLM /team/info -> ${r.status}`);
  const t = r.json.team_info;
  const members = ((t.members_with_roles as Raw[] | undefined) ?? []).map((m) => ({ userId: String(m.user_id), role: String(m.role) }));
  return {
    teamId: String(t.team_id),
    alias: (t.team_alias as string) ?? null,
    maxBudget: (t.max_budget as number) ?? null,
    budgetDuration: (t.budget_duration as string) ?? null,
    blocked: Boolean(t.blocked),
    members,
    metadata: (t.metadata as Raw) ?? {},
  };
}

/** Team admins are a LiteLLM Enterprise feature; without LITELLM_LICENSE the adapter falls back to 'user'. */
export const TEAM_ADMIN_ROLE = 'user';

export async function teamRole(teamId: string, userId: string): Promise<string | null> {
  return (await getTeam(teamId))?.members.find((m) => m.userId === userId)?.role ?? null;
}

export async function getUser(userId: string): Promise<{ maxBudget: number | null; blocked: boolean; teams: string[] } | null> {
  const r = await call<{ user_info?: Raw; teams?: Raw[] }>('GET', `/user/info?user_id=${encodeURIComponent(userId)}`);
  if (r.status >= 400 || !r.json?.user_info) return null;
  const u = r.json.user_info;
  const teams = (u.teams as string[] | undefined) ?? (r.json.teams ?? []).map((t) => String(t.team_id));
  return { maxBudget: (u.max_budget as number) ?? null, blocked: Boolean(u.blocked), teams };
}

/** Key info by plaintext secret. */
/** False once LiteLLM deleted the key (e.g. on /team/member_delete); the key is also dropped from cleanup. */
export async function keyExists(secret: string): Promise<boolean> {
  const r = await call('GET', `/key/info?key=${encodeURIComponent(secret)}`);
  if (r.status === 404) {
    created.keys.delete(secret);
    return false;
  }
  if (r.status >= 400) throw new Error(`LiteLLM /key/info -> ${r.status}`);
  return true;
}

export async function getKey(secret: string): Promise<{ blocked: boolean; teamId: string | null; userId: string | null; models: string[] }> {
  const r = await ok<{ info: Raw }>('GET', `/key/info?key=${encodeURIComponent(secret)}`);
  return {
    blocked: Boolean(r.info.blocked),
    teamId: (r.info.team_id as string) ?? null,
    userId: (r.info.user_id as string) ?? null,
    models: (r.info.models as string[]) ?? [],
  };
}

/** One tiny chat completion with the user's key, straight against LiteLLM. Returns the HTTP status. */
export async function chatDirect(secret: string, model: string): Promise<number> {
  const r = await call('POST', '/v1/chat/completions', { model, max_tokens: 5, messages: [{ role: 'user', content: 'Say OK' }] }, secret);
  return r.status;
}

/** Everything this run created in LiteLLM; removed in teardown (plan decision d). */
export const created = { users: new Set<string>(), teams: new Set<string>(), keys: new Set<string>() };

export async function cleanup(): Promise<string[]> {
  const errors: string[] = [];
  const attempt = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${what}: ${(e as Error).message}`);
    }
  };
  if (created.keys.size) await attempt('keys', () => ok('POST', '/key/delete', { keys: [...created.keys] }));
  for (const id of created.teams) await attempt(`team ${id}`, () => getTeam(id).then((t) => (t ? ok('POST', '/team/delete', { team_ids: [id] }) : null)));
  if (created.users.size) await attempt('users', () => ok('POST', '/user/delete', { user_ids: [...created.users] }));
  created.keys.clear();
  created.teams.clear();
  created.users.clear();
  return errors;
}
