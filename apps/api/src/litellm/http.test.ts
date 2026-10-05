import { describe, expect, it } from 'vitest';
import { createHttpAdapter } from './http.js';
import { LiteLLMHttpError } from './types.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Fake fetch that records calls and answers from a handler. */
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown } | undefined = () => ({})) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = handler(call) ?? {};
    const status = r.status ?? 200;
    return new Response(r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls, fetch: f };
}

const adapter = (handler?: Parameters<typeof fakeFetch>[0]) => {
  const ff = fakeFetch(handler);
  return { ...ff, a: createHttpAdapter({ baseUrl: 'http://litellm.test/', apiKey: 'sk-master', fetchImpl: ff.fetch }) };
};

describe('http adapter', () => {
  it('sends the master key and strips the trailing slash of the base url', async () => {
    const { a, calls } = adapter(() => ({ body: { user_id: 'u1' } }));
    await a.createUser({ userId: 'u1', email: 'a@b.c', alias: 'A' });
    expect(calls[0]!.url).toBe('http://litellm.test/user/new');
    expect(calls[0]!.headers.Authorization).toBe('Bearer sk-master');
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    expect(calls[0]!.body).toEqual({ user_id: 'u1', user_email: 'a@b.c', user_alias: 'A', auto_create_key: false });
  });

  it('createUser falls back to the given id when the response has none', async () => {
    const { a } = adapter(() => ({ body: {} }));
    expect(await a.createUser({ userId: 'u9', email: 'x@y.z' })).toEqual({ litellmUserId: 'u9' });
  });

  it('updateUserBudget / blockUser post to /user/update', async () => {
    const { a, calls } = adapter();
    await a.updateUserBudget('u1', { maxBudget: 25, budgetDuration: '30d' });
    await a.blockUser('u1', true);
    expect(calls[0]).toMatchObject({ url: 'http://litellm.test/user/update', method: 'POST', body: { user_id: 'u1', max_budget: 25, budget_duration: '30d' } });
    expect(calls[1]).toMatchObject({ body: { user_id: 'u1', blocked: true } });
  });

  it('createKey sends duration in seconds, models, alias, budget, budget duration and metadata and maps the response', async () => {
    const { a, calls } = adapter(() => ({
      body: { key: 'sk-plain', token_id: 'hashed-token', key_alias: 'alias-from-server', models: ['m1'], max_budget: 5, expires: '2027-01-01T00:00:00Z' },
    }));
    const expiresAt = new Date(Date.now() + 3600_000);
    const k = await a.createKey({ litellmUserId: 'u1', teamId: 'cc-1', alias: 'me:k', models: ['m1', 'm2'], maxBudget: 5, budgetDuration: '30d', expiresAt, metadata: { cost_center: '12345678' } });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(calls[0]!.url).toBe('http://litellm.test/key/generate');
    expect(body.user_id).toBe('u1');
    expect(body.team_id).toBe('cc-1');
    expect(body.key_alias).toBe('me:k');
    expect(body.models).toEqual(['m1', 'm2']);
    expect(body.max_budget).toBe(5);
    expect(body.budget_duration).toBe('30d');
    expect(body.metadata).toEqual({ cost_center: '12345678' });
    const m = /^(\d+)s$/.exec(String(body.duration));
    expect(m, `duration ${body.duration}`).not.toBeNull();
    const seconds = Number(m![1]);
    expect(seconds).toBeGreaterThan(3590);
    expect(seconds).toBeLessThanOrEqual(3600);
    expect(k).toEqual({
      keyId: 'hashed-token',
      secret: 'sk-plain',
      alias: 'alias-from-server',
      models: ['m1'],
      maxBudget: 5,
      budgetDuration: '30d',
      expires: '2027-01-01T00:00:00Z',
      blocked: false,
      spend: 0,
      teamId: 'cc-1',
    });
  });

  it('createKey uses at least 60s and falls back to token / key as id', async () => {
    const { a, calls } = adapter(() => ({ body: { key: 'sk-x', token: 'tok' } }));
    const k = await a.createKey({ litellmUserId: 'u', teamId: null, alias: 'a', models: ['m'], maxBudget: null, budgetDuration: null, expiresAt: new Date(Date.now() - 1000) });
    expect((calls[0]!.body as { duration: string }).duration).toBe('60s');
    expect('team_id' in (calls[0]!.body as object)).toBe(false);
    // without a period the budget never resets
    expect('budget_duration' in (calls[0]!.body as object)).toBe(false);
    expect(k.teamId).toBeNull();
    expect(k.keyId).toBe('tok');
    expect(k.models).toEqual(['m']);
    expect(k.maxBudget).toBeNull();
    const { a: a2 } = adapter(() => ({ body: { key: 'sk-only' } }));
    expect((await a2.createKey({ litellmUserId: 'u', teamId: null, alias: 'a', models: [], maxBudget: null, budgetDuration: null, expiresAt: new Date() })).keyId).toBe('sk-only');
  });

  it('updateKey sends only the given fields (blocked, budget, alias, models, duration)', async () => {
    const { a, calls } = adapter();
    await a.updateKey('k1', { blocked: true });
    expect(calls[0]).toMatchObject({ url: 'http://litellm.test/key/update', method: 'POST', body: { key: 'k1', blocked: true } });
    expect(Object.keys(calls[0]!.body as object).sort()).toEqual(['blocked', 'key']);

    await a.updateKey('k1', { maxBudget: null, budgetDuration: null, alias: 'n', models: ['a'], expiresAt: new Date(Date.now() + 120_000) });
    const b = calls[1]!.body as Record<string, unknown>;
    expect(b.max_budget).toBeNull();
    expect(b.budget_duration).toBeNull();
    expect(b.key_alias).toBe('n');
    expect(b.models).toEqual(['a']);
    expect(String(b.duration)).toMatch(/^1(19|20)s$/);
    expect(b.blocked).toBeUndefined();
  });

  it('deleteKey posts the key list', async () => {
    const { a, calls } = adapter();
    await a.deleteKey('k1');
    expect(calls[0]).toMatchObject({ url: 'http://litellm.test/key/delete', method: 'POST', body: { keys: ['k1'] } });
  });

  it('listModels maps provider from custom_llm_provider or the model prefix', async () => {
    const { a, calls } = adapter(() => ({
      body: {
        data: [
          {
            model_name: 'gpt-4o',
            model_info: { id: 'id-1', input_cost_per_token: 0.0000025, output_cost_per_token: 0.00001 },
            litellm_params: { model: 'openai/gpt-4o', custom_llm_provider: 'azure' },
          },
          // a per-deployment price in litellm_params wins over the model cost map
          {
            model_name: 'claude',
            model_info: { id: 'id-2', input_cost_per_token: 0.000003, output_cost_per_token: 0.000015 },
            litellm_params: { model: 'anthropic/claude-3', input_cost_per_token: '0.000001' },
          },
          { model_name: 'plain', litellm_params: { model: 'plain-model' } },
          { model_name: 'empty' },
        ],
      },
    }));
    const models = await a.listModels();
    expect(calls[0]).toMatchObject({ url: 'http://litellm.test/model/info', method: 'GET' });
    expect(calls[0]!.body).toBeUndefined();
    expect(models).toEqual([
      { modelName: 'gpt-4o', modelId: 'id-1', provider: 'azure', inputCostPerToken: 0.0000025, outputCostPerToken: 0.00001 },
      { modelName: 'claude', modelId: 'id-2', provider: 'anthropic', inputCostPerToken: 0.000001, outputCostPerToken: 0.000015 },
      { modelName: 'plain', modelId: null, provider: null, inputCostPerToken: null, outputCostPerToken: null },
      { modelName: 'empty', modelId: null, provider: null, inputCostPerToken: null, outputCostPerToken: null },
    ]);
  });

  it('listModels tolerates a missing data array', async () => {
    const { a } = adapter(() => ({ body: {} }));
    expect(await a.listModels()).toEqual([]);
  });

  it('key test calls authenticate with the given key, not the master key', async () => {
    const { a, calls } = adapter((c) =>
      c.url.endsWith('/v1/models')
        ? { body: { data: [{ id: 'gpt-4o' }, { id: 'gemma' }] } }
        : { body: { model: 'gpt-4o-2024-08-06', choices: [{ message: { content: 'Hi' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } } },
    );
    expect(await a.listKeyModels('sk-user')).toEqual(['gpt-4o', 'gemma']);
    expect(await a.chatWithKey('sk-user', { model: 'gpt-4o', prompt: 'Hello', maxTokens: 50 })).toEqual({ model: 'gpt-4o-2024-08-06', answer: 'Hi', promptTokens: 5, completionTokens: 1 });
    expect(calls[0]).toMatchObject({ url: 'http://litellm.test/v1/models', method: 'GET' });
    expect(calls[1]).toMatchObject({ url: 'http://litellm.test/v1/chat/completions', method: 'POST', body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }], max_tokens: 50 } });
    expect(calls.map((c) => c.headers.Authorization)).toEqual(['Bearer sk-user', 'Bearer sk-user']);
  });

  it('key test calls tolerate missing data, choices and usage', async () => {
    const { a } = adapter(() => ({ body: {} }));
    expect(await a.listKeyModels('sk-user')).toEqual([]);
    expect(await a.chatWithKey('sk-user', { model: 'm', prompt: 'p', maxTokens: 1 })).toEqual({ model: 'm', answer: '', promptTokens: null, completionTokens: null });
  });

  it('getSpendLogs queries /spend/logs/v2 by time, maps fields and filters by [since, until)', async () => {
    const since = new Date('2026-09-10T00:00:00Z');
    const until = new Date('2026-09-12T00:00:00.500Z');
    const { a, calls } = adapter(() => ({
      body: {
        data: [
          {
            request_id: 'r1',
            session_id: 's1',
            startTime: '2026-09-11T10:00:00Z',
            endTime: '2026-09-11T10:00:02Z',
            completionStartTime: '2026-09-11T10:00:00.500Z',
            call_type: 'acompletion',
            model: 'gpt-4o',
            custom_llm_provider: 'openai',
            api_key: 'hash1',
            user: 'u1',
            spend: '0.25',
            prompt_tokens: 10,
            completion_tokens: 20,
            request_tags: ['t1'],
            metadata: { status: 'success' },
          },
          {
            request_id: 'r2',
            start_time: '2026-09-11T11:00:00Z',
            model: 'x',
            api_key: 'hash1',
            spend: 0.5,
            metadata: { status: 'failure', error_information: 'boom' },
          },
          { request_id: 'too-early', startTime: '2026-09-09T23:59:59Z', model: 'x', api_key: 'h', spend: 1 },
          { request_id: 'at-until', startTime: '2026-09-12T00:00:00.500Z', model: 'x', api_key: 'h', spend: 1 },
          { request_id: 'bad-date', startTime: 'not-a-date', model: 'x', api_key: 'h', spend: 1 },
          // per-day aggregate rows (legacy /spend/logs) have no request_id and are never stored
          { startTime: '2026-09-11', spend: 3, users: {}, models: {} },
        ],
      },
    }));
    const logs = await a.getSpendLogs(since, until);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/spend/logs/v2');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      start_date: '2026-09-10 00:00:00',
      end_date: '2026-09-12 00:00:01',
      page: '1',
      page_size: '1000',
      sort_by: 'startTime',
      sort_order: 'asc',
    });
    expect(logs.map((l) => l.requestId)).toEqual(['r1', 'r2']);
    expect(logs[0]).toEqual({
      requestId: 'r1',
      sessionId: 's1',
      startTime: '2026-09-11T10:00:00.000Z',
      endTime: '2026-09-11T10:00:02Z',
      callType: 'acompletion',
      status: 'success',
      model: 'gpt-4o',
      provider: 'openai',
      apiKey: 'hash1',
      litellmUserId: 'u1',
      spend: 0.25,
      promptTokens: 10,
      completionTokens: 20,
      durationMs: 2000,
      ttftMs: 500,
      tags: ['t1'],
      error: null,
    });
    expect(logs[1]).toMatchObject({
      requestId: 'r2',
      status: 'failure',
      error: 'boom',
      callType: 'llm',
      provider: null,
      litellmUserId: null,
      durationMs: null,
      ttftMs: null,
      tags: [],
      sessionId: null,
      spend: 0.5,
    });
  });

  it('getSpendLogs pages until a short page and maps the v2 row shape', async () => {
    const since = new Date('2026-10-01T00:00:00Z');
    const until = new Date('2026-10-02T00:00:00Z');
    const row = (i: number) => ({ request_id: `p${i}`, startTime: '2026-10-01T08:00:00.000+00:00', api_key: 'h', spend: 0 });
    const { a, calls } = adapter(({ url }) => {
      const page = new URL(url).searchParams.get('page');
      if (page === '1') return { body: { data: Array.from({ length: 1000 }, (_, i) => row(i)), total: 10000, total_is_capped: true } };
      return {
        body: {
          data: [
            {
              request_id: 'chatcmpl-1',
              call_type: 'acompletion',
              startTime: '2026-10-01T08:09:47.497+00:00',
              endTime: '2026-10-01T08:09:48.835+00:00',
              completionStartTime: '2026-10-01T08:09:48.834+00:00',
              model: 'azure/gpt-5.6-luna',
              model_group: 'Fast (gpt-5.6-luna)',
              custom_llm_provider: 'azure',
              api_key: 'hash1',
              user: 'u1',
              spend: 1.46e-5,
              prompt_tokens: 19,
              completion_tokens: 9,
              request_duration_ms: 1338,
              session_id: 's1',
              status: 'success',
              metadata: { status: null },
            },
            {
              request_id: 'f1',
              call_type: '',
              startTime: '2026-10-01T09:00:00.000+00:00',
              model: '',
              model_group: '',
              custom_llm_provider: '',
              api_key: null,
              user: '',
              session_id: '',
              status: 'failure',
              request_duration_ms: 0,
              metadata: { status: 'failure', error_information: { error_class: 'Exception', error_message: 'No api key passed in.', traceback: 'x' } },
            },
          ],
        },
      };
    });
    const logs = await a.getSpendLogs(since, until);
    expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(logs).toHaveLength(1002);
    expect(logs[1000]).toMatchObject({ requestId: 'chatcmpl-1', status: 'success', model: 'Fast (gpt-5.6-luna)', provider: 'azure', litellmUserId: 'u1', durationMs: 1338, ttftMs: 1337, error: null });
    expect(logs[1001]).toMatchObject({
      requestId: 'f1',
      status: 'failure',
      model: '',
      callType: 'llm',
      provider: null,
      apiKey: '',
      litellmUserId: null,
      sessionId: null,
      durationMs: 0,
      error: 'No api key passed in.',
    });
  });

  it('createUser sends sso_user_id only when given; updateUser sends only the given fields', async () => {
    const { a, calls } = adapter(() => ({ body: {} }));
    await a.createUser({ userId: 'u1', email: 'a@b.c', ssoUserId: 'kc-1' });
    expect(calls[0]!.body).toMatchObject({ user_id: 'u1', sso_user_id: 'kc-1' });
    await a.updateUser('u1', { ssoUserId: 'kc-2' });
    expect(calls[1]).toMatchObject({ url: 'http://litellm.test/user/update', body: { user_id: 'u1', sso_user_id: 'kc-2' } });
    expect(Object.keys(calls[1]!.body as object).sort()).toEqual(['sso_user_id', 'user_id']);
  });

  it('getUser maps /user/info and returns null for unknown users', async () => {
    const { a, calls } = adapter(({ url }) =>
      url.includes('u1')
        ? { body: { user_id: 'u1', user_info: { user_id: 'u1', user_email: 'a@b.c', user_alias: 'A', sso_user_id: 'kc', max_budget: 5, spend: '1.5', blocked: false, teams: ['t1'] } } }
        : url.includes('gone')
          ? { status: 404, body: { error: 'User not found' } }
          : { body: { user_id: 'x', user_info: null } },
    );
    expect(await a.getUser('u1')).toEqual({ userId: 'u1', email: 'a@b.c', alias: 'A', ssoUserId: 'kc', maxBudget: 5, spend: 1.5, blocked: false, teams: ['t1'] });
    expect(calls[0]).toMatchObject({ url: 'http://litellm.test/user/info?user_id=u1', method: 'GET' });
    expect(await a.getUser('gone')).toBeNull();
    expect(await a.getUser('nobody')).toBeNull();
  });

  it('listUsers pages through /user/list and narrows by exact e-mail', async () => {
    const { a, calls } = adapter(() => ({
      body: {
        users: [
          { user_id: 'u1', user_email: 'A@b.c' },
          { user_id: 'u2', user_email: 'other@b.c' },
        ],
        total: 2,
        page: 1,
        page_size: 50,
      },
    }));
    const all = await a.listUsers({ page: 2, pageSize: 50 });
    expect(calls[0]!.url).toBe('http://litellm.test/user/list?page=2&page_size=50');
    expect(all.total).toBe(2);
    expect(all.items.map((u) => u.userId)).toEqual(['u1', 'u2']);
    expect(all.items[0]).toMatchObject({ email: 'A@b.c', alias: null, ssoUserId: null, maxBudget: null, spend: 0, blocked: false, teams: [] });
    const byMail = await a.listUsers({ page: 1, pageSize: 5, email: 'a@B.c' });
    expect(calls[1]!.url).toBe('http://litellm.test/user/list?page=1&page_size=100&user_email=a%40B.c');
    expect(byMail).toEqual({ items: [expect.objectContaining({ userId: 'u1' })], total: 1 });
  });

  it('listUsers by e-mail finds the exact address behind a full page of substring matches', async () => {
    const similar = Array.from({ length: 100 }, (_, i) => ({ user_id: `x${i}`, user_email: `x${i}sven@b.c` }));
    const { a, calls } = adapter(({ url }) => ({ body: { users: url.includes('page=1&') ? similar : [{ user_id: 'sven', user_email: 'Sven@b.c' }] } }));
    expect(await a.listUsers({ page: 1, pageSize: 1, email: 'sven@b.c' })).toEqual({ items: [expect.objectContaining({ userId: 'sven' })], total: 1 });
    expect(calls.map((c) => c.url)).toEqual(['http://litellm.test/user/list?page=1&page_size=100&user_email=sven%40b.c', 'http://litellm.test/user/list?page=2&page_size=100&user_email=sven%40b.c']);
  });

  it('teams: create, update, block/unblock, info', async () => {
    const { a, calls } = adapter(({ url }) =>
      url.includes('/team/info')
        ? url.includes('missing')
          ? { status: 404, body: { error: 'Team not found' } }
          : { body: { team_id: 'cc-1', team_info: { team_id: 'cc-1', team_alias: '12345678 Lab', max_budget: 100, budget_duration: '30d', models: ['m1'], blocked: true, spend: 2 } } }
        : { body: { team_id: 'cc-1' } },
    );
    expect(await a.createTeam({ teamId: 'cc-1', alias: '12345678 Lab', maxBudget: 100, budgetDuration: '30d', metadata: { cost_center: '12345678' } })).toEqual({ teamId: 'cc-1' });
    expect(calls[0]).toMatchObject({
      url: 'http://litellm.test/team/new',
      method: 'POST',
      // no released models = all models (F-KST-15)
      body: { team_id: 'cc-1', team_alias: '12345678 Lab', max_budget: 100, budget_duration: '30d', models: [], metadata: { cost_center: '12345678' } },
    });
    await a.updateTeam('cc-1', { maxBudget: null });
    expect(calls[1]).toMatchObject({ url: 'http://litellm.test/team/update', body: { team_id: 'cc-1', max_budget: null } });
    expect(Object.keys(calls[1]!.body as object).sort()).toEqual(['max_budget', 'team_id']);
    await a.setTeamBlocked('cc-1', true);
    await a.setTeamBlocked('cc-1', false);
    expect(calls[2]).toMatchObject({ url: 'http://litellm.test/team/block', body: { team_id: 'cc-1' } });
    expect(calls[3]).toMatchObject({ url: 'http://litellm.test/team/unblock', body: { team_id: 'cc-1' } });
    expect(await a.getTeam('cc-1')).toEqual({ teamId: 'cc-1', alias: '12345678 Lab', maxBudget: 100, budgetDuration: '30d', models: ['m1'], blocked: true, spend: 2 });
    expect(calls[4]!.url).toBe('http://litellm.test/team/info?team_id=cc-1');
    await a.updateTeam('cc-1', { models: ['m1', 'm2'] });
    expect(calls[5]).toMatchObject({ url: 'http://litellm.test/team/update', body: { team_id: 'cc-1', models: ['m1', 'm2'] } });
    expect(await a.getTeam('missing')).toBeNull();
  });

  it('team members: add falls back to role update for existing members; delete tolerates non-members', async () => {
    const { a, calls } = adapter(({ url }) =>
      url.endsWith('/team/member_add') ? { status: 400, body: { error: 'User already in team' } } : url.endsWith('/team/member_delete') ? { status: 404, body: {} } : {},
    );
    await a.setTeamMember('cc-1', 'u1', 'admin');
    expect(calls[0]).toMatchObject({ url: 'http://litellm.test/team/member_add', body: { team_id: 'cc-1', member: [{ user_id: 'u1', role: 'admin' }] } });
    expect(calls[1]).toMatchObject({ url: 'http://litellm.test/team/member_update', body: { team_id: 'cc-1', user_id: 'u1', role: 'admin' } });
    await a.removeTeamMember('cc-1', 'u1');
    expect(calls[2]).toMatchObject({ url: 'http://litellm.test/team/member_delete', body: { team_id: 'cc-1', user_id: 'u1' } });
    const { a: strict } = adapter(() => ({ status: 500, body: 'boom' }));
    await expect(strict.setTeamMember('cc-1', 'u1', 'user')).rejects.toBeInstanceOf(LiteLLMHttpError);
    await expect(strict.removeTeamMember('cc-1', 'u1')).rejects.toBeInstanceOf(LiteLLMHttpError);
  });

  it('wraps non-2xx responses in LiteLLMHttpError', async () => {
    const { a } = adapter(() => ({ status: 401, body: { error: 'invalid key' } }));
    const err = await a.deleteKey('k').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiteLLMHttpError);
    const e = err as LiteLLMHttpError;
    expect(e.status).toBe(401);
    expect(e.path).toBe('/key/delete');
    expect(e.body).toContain('invalid key');
    expect(e.message).toMatch(/LiteLLM \/key\/delete -> 401/);
  });

  it('health reports readiness and swallows network errors', async () => {
    const { a, calls } = adapter(() => ({ status: 200, body: 'ready' }));
    expect(await a.health()).toEqual({ ok: true, detail: 'ready' });
    expect(calls[0]!.url).toBe('http://litellm.test/health/readiness');
    const bad = createHttpAdapter({
      baseUrl: 'http://x',
      apiKey: '',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    expect(await bad.health()).toEqual({ ok: false, detail: 'ECONNREFUSED' });
  });
});
