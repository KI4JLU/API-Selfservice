import type { LiteLLMAdapter, LiteLLMKey, LiteLLMModel, LiteLLMSpendLog, LiteLLMTeam, LiteLLMUser } from './types.js';
import { LiteLLMHttpError } from './types.js';

interface Opts {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

type Raw = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapUser(r: Raw): LiteLLMUser {
  return {
    userId: String(r.user_id),
    email: (r.user_email as string | null) ?? null,
    alias: (r.user_alias as string | null) ?? null,
    ssoUserId: (r.sso_user_id as string | null) ?? null,
    maxBudget: r.max_budget == null ? null : Number(r.max_budget),
    spend: Number(r.spend ?? 0),
    blocked: Boolean(r.blocked ?? false),
    teams: Array.isArray(r.teams) ? (r.teams as unknown[]).map((t) => (typeof t === 'object' && t !== null ? String((t as Raw).team_id) : String(t))) : [],
  };
}

/** Exact e-mail lookups page through LiteLLM's substring matches (largest page LiteLLM allows, bounded). */
const EMAIL_LOOKUP_PAGE_SIZE = 100;
const EMAIL_LOOKUP_MAX_PAGES = 20;

function mapTeam(r: Raw): LiteLLMTeam {
  return {
    teamId: String(r.team_id),
    alias: String(r.team_alias ?? ''),
    maxBudget: r.max_budget == null ? null : Number(r.max_budget),
    budgetDuration: (r.budget_duration as string | null) ?? null,
    models: Array.isArray(r.models) ? (r.models as unknown[]).map(String) : [],
    blocked: Boolean(r.blocked ?? false),
    spend: Number(r.spend ?? 0),
  };
}

const isNotFound = (e: unknown) =>
  e instanceof LiteLLMHttpError && (e.status === 404 || (e.status === 400 && /not found|does not exist/i.test(e.body)));

/**
 * REST adapter for the LiteLLM proxy. Uses the documented admin endpoints:
 * /user/{new,update,info,list}, /team/{new,update,info,block,unblock,member_add,member_update,member_delete},
 * /key/{generate,update,delete}, /model/info, /spend/logs/v2.
 */
export function createHttpAdapter(opts: Opts): LiteLLMAdapter {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');

  async function call<T>(method: string, path: string, body?: unknown, token = opts.apiKey): Promise<T> {
    const res = await f(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new LiteLLMHttpError(res.status, text, path);
    return (text ? JSON.parse(text) : {}) as T;
  }

  const toDuration = (d: string | null) => d;
  const seconds = (expiresAt: Date) => Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

  return {
    mode: 'http',
    async health() {
      try {
        // Short timeout: /health backs the container healthcheck (5 s) and must not wait for an unreachable proxy.
        const res = await f(`${base}/health/readiness`, { signal: AbortSignal.timeout(3000) });
        return { ok: res.ok, detail: await res.text() };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },

    // ---------- users ----------
    async getUser(userId) {
      let r: { user_info?: Raw | null; teams?: unknown[] };
      try {
        r = await call('GET', `/user/info?user_id=${encodeURIComponent(userId)}`);
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
      if (!r.user_info || typeof r.user_info !== 'object') return null;
      const u = mapUser(r.user_info);
      if (!u.teams.length && Array.isArray(r.teams)) u.teams = r.teams.map((t) => String((t as Raw).team_id ?? t));
      return u;
    },
    async listUsers({ page, pageSize, email, search }) {
      if (email) {
        // LiteLLM matches user_email as a substring, so the exact address can sit behind other matches on a
        // later page (sven@x.de behind xsven@x.de). Collect the exact matches of all pages, then paginate those.
        const exact: LiteLLMUser[] = [];
        for (let p = 1; p <= EMAIL_LOOKUP_MAX_PAGES; p++) {
          const qs = new URLSearchParams({ page: String(p), page_size: String(EMAIL_LOOKUP_PAGE_SIZE), user_email: email });
          const rows = (await call<{ users?: Raw[] }>('GET', `/user/list?${qs.toString()}`)).users ?? [];
          exact.push(...rows.map(mapUser).filter((u) => u.email?.toLowerCase() === email.toLowerCase()));
          if (rows.length < EMAIL_LOOKUP_PAGE_SIZE) break;
        }
        return { items: exact.slice((page - 1) * pageSize, page * pageSize), total: exact.length };
      }
      const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (search && UUID_RE.test(search)) qs.set('user_ids', search);
      else if (search) qs.set('user_email', search); // LiteLLM filters case-insensitively by substring
      const r = await call<{ users?: Raw[]; total?: number }>('GET', `/user/list?${qs.toString()}`);
      const items = (r.users ?? []).map(mapUser);
      return { items, total: Number(r.total ?? items.length) };
    },
    async createUser({ userId, email, alias, ssoUserId }) {
      const r = await call<{ user_id: string }>('POST', '/user/new', {
        user_id: userId,
        user_email: email,
        user_alias: alias ?? email,
        ...(ssoUserId ? { sso_user_id: ssoUserId } : {}),
        auto_create_key: false,
      });
      return { litellmUserId: r.user_id ?? userId };
    },
    async updateUser(userId, patch) {
      const body: Raw = { user_id: userId };
      if (patch.email !== undefined) body.user_email = patch.email;
      if (patch.alias !== undefined) body.user_alias = patch.alias;
      if (patch.ssoUserId !== undefined) body.sso_user_id = patch.ssoUserId;
      await call('POST', '/user/update', body);
    },
    async updateUserBudget(userId, { maxBudget, budgetDuration }) {
      await call('POST', '/user/update', {
        user_id: userId,
        max_budget: maxBudget,
        budget_duration: toDuration(budgetDuration),
      });
    },
    async blockUser(userId, blocked) {
      await call('POST', '/user/update', { user_id: userId, blocked });
    },

    // ---------- teams ----------
    async getTeam(teamId) {
      try {
        const r = await call<{ team_info?: Raw | null }>('GET', `/team/info?team_id=${encodeURIComponent(teamId)}`);
        return r.team_info && typeof r.team_info === 'object' ? mapTeam(r.team_info) : null;
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async createTeam({ teamId, alias, maxBudget, budgetDuration, models, metadata }) {
      const r = await call<{ team_id?: string }>('POST', '/team/new', {
        team_id: teamId,
        team_alias: alias,
        max_budget: maxBudget,
        budget_duration: toDuration(budgetDuration),
        models: models ?? [],
        metadata: metadata ?? {},
      });
      return { teamId: r.team_id ?? teamId };
    },
    async updateTeam(teamId, patch) {
      const body: Raw = { team_id: teamId };
      if (patch.alias !== undefined) body.team_alias = patch.alias;
      if (patch.maxBudget !== undefined) body.max_budget = patch.maxBudget;
      if (patch.budgetDuration !== undefined) body.budget_duration = toDuration(patch.budgetDuration);
      if (patch.models !== undefined) body.models = patch.models;
      await call('POST', '/team/update', body);
    },
    async setTeamBlocked(teamId, blocked) {
      await call('POST', blocked ? '/team/block' : '/team/unblock', { team_id: teamId });
    },
    async setTeamMember(teamId, userId, role) {
      try {
        await call('POST', '/team/member_add', { team_id: teamId, member: [{ user_id: userId, role }] });
      } catch (e) {
        // already a member -> only the role may differ
        if (!(e instanceof LiteLLMHttpError && e.status === 400)) throw e;
        await call('POST', '/team/member_update', { team_id: teamId, user_id: userId, role });
      }
    },
    async removeTeamMember(teamId, userId) {
      try {
        await call('POST', '/team/member_delete', { team_id: teamId, user_id: userId });
      } catch (e) {
        if (!(e instanceof LiteLLMHttpError && (e.status === 400 || e.status === 404))) throw e;
      }
    },

    // ---------- keys ----------
    async createKey({ litellmUserId, teamId, alias, models, maxBudget, budgetDuration, expiresAt, metadata }) {
      const r = await call<{
        key: string;
        token?: string;
        token_id?: string;
        key_alias?: string;
        models?: string[];
        max_budget?: number | null;
        budget_duration?: string | null;
        expires?: string | null;
        team_id?: string | null;
      }>('POST', '/key/generate', {
        user_id: litellmUserId,
        ...(teamId ? { team_id: teamId } : {}),
        key_alias: alias,
        models,
        max_budget: maxBudget,
        ...(budgetDuration ? { budget_duration: toDuration(budgetDuration) } : {}),
        duration: `${seconds(expiresAt)}s`,
        metadata: metadata ?? {},
      });
      const keyId = r.token_id ?? r.token ?? r.key;
      return {
        keyId,
        secret: r.key,
        alias: r.key_alias ?? alias,
        models: r.models ?? models,
        maxBudget: r.max_budget ?? maxBudget,
        budgetDuration: r.budget_duration ?? budgetDuration,
        expires: r.expires ?? expiresAt.toISOString(),
        blocked: false,
        spend: 0,
        teamId: r.team_id ?? teamId,
      } satisfies LiteLLMKey & { secret: string };
    },
    async updateKey(keyId, patch) {
      const body: Record<string, unknown> = { key: keyId };
      if (patch.models) body.models = patch.models;
      if (patch.maxBudget !== undefined) body.max_budget = patch.maxBudget;
      if (patch.budgetDuration !== undefined) body.budget_duration = toDuration(patch.budgetDuration);
      if (patch.alias !== undefined) body.key_alias = patch.alias;
      if (patch.blocked !== undefined) body.blocked = patch.blocked;
      if (patch.expiresAt) body.duration = `${seconds(patch.expiresAt)}s`;
      await call('POST', '/key/update', body);
    },
    async deleteKey(keyId) {
      await call('POST', '/key/delete', { keys: [keyId] });
    },
    async listModels() {
      type Cost = { input_cost_per_token?: number | string | null; output_cost_per_token?: number | string | null };
      const r = await call<{ data: Array<{ model_name: string; model_info?: { id?: string } & Cost; litellm_params?: { model?: string; custom_llm_provider?: string } & Cost }> }>(
        'GET',
        '/model/info',
      );
      const cost = (v: number | string | null | undefined): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      return (r.data ?? []).map((m): LiteLLMModel => {
        const raw = m.litellm_params?.model ?? '';
        const provider = m.litellm_params?.custom_llm_provider ?? (raw.includes('/') ? raw.split('/')[0]! : null);
        return {
          modelName: m.model_name,
          modelId: m.model_info?.id ?? null,
          provider,
          // litellm_params overrides (per deployment) win over the model cost map in model_info
          inputCostPerToken: cost(m.litellm_params?.input_cost_per_token) ?? cost(m.model_info?.input_cost_per_token),
          outputCostPerToken: cost(m.litellm_params?.output_cost_per_token) ?? cost(m.model_info?.output_cost_per_token),
        };
      });
    },
    async listKeyModels(secret) {
      const r = await call<{ data?: Array<{ id: string }> }>('GET', '/v1/models', undefined, secret);
      return (r.data ?? []).map((m) => m.id);
    },
    async chatWithKey(secret, { model, prompt, maxTokens }) {
      const r = await call<{
        model?: string;
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>('POST', '/v1/chat/completions', { model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens }, secret);
      return {
        model: r.model ?? model,
        answer: r.choices?.[0]?.message?.content ?? '',
        promptTokens: r.usage?.prompt_tokens ?? null,
        completionTokens: r.usage?.completion_tokens ?? null,
      };
    },
    async getSpendLogs(since, until) {
      // /spend/logs without summarize=false only returns per-day aggregates (no request_id), so we use
      // /spend/logs/v2: filters to the second (UTC) and pages. Its `total` is capped, so we page until a short page.
      const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
      const pageSize = 1000;
      const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
      const errorText = (v: unknown) =>
        v && typeof v === 'object' ? str((v as Raw).error_message) ?? str((v as Raw).error_class) : v ? String(v) : null;
      const out: LiteLLMSpendLog[] = [];
      for (let page = 1; ; page++) {
        const qs = new URLSearchParams({
          start_date: fmt(since),
          end_date: fmt(new Date(until.getTime() + 1000)),
          page: String(page),
          page_size: String(pageSize),
          sort_by: 'startTime',
          sort_order: 'asc',
        });
        const res = await call<{ data?: Raw[] }>('GET', `/spend/logs/v2?${qs.toString()}`);
        const rows = res.data ?? [];
        for (const r of rows) {
          if (!str(r.request_id)) continue;
          const startTime = String(r.startTime ?? r.start_time ?? '');
          const t = new Date(startTime);
          if (Number.isNaN(t.getTime()) || t < since || t >= until) continue;
          const endTime = r.endTime ? String(r.endTime) : null;
          const meta = (r.metadata as Raw | undefined) ?? {};
          const status = String(r.status ?? meta.status ?? 'success') === 'failure' ? 'failure' : 'success';
          const tags = Array.isArray(r.request_tags) ? (r.request_tags as string[]) : [];
          const duration =
            typeof r.request_duration_ms === 'number' ? r.request_duration_ms : endTime ? new Date(endTime).getTime() - t.getTime() : null;
          const ttft = typeof r.completionStartTime === 'string' ? new Date(r.completionStartTime).getTime() - t.getTime() : null;
          out.push({
            requestId: String(r.request_id),
            sessionId: str(r.session_id),
            startTime: t.toISOString(),
            endTime,
            callType: str(r.call_type) ?? 'llm',
            status,
            // model_group is the public model name keys are created with; model is the deployment (e.g. azure/...)
            model: str(r.model_group) ?? String(r.model ?? ''),
            provider: str(r.custom_llm_provider),
            apiKey: String(r.api_key ?? ''),
            litellmUserId: str(r.user),
            spend: Number(r.spend ?? 0),
            promptTokens: Number(r.prompt_tokens ?? 0),
            completionTokens: Number(r.completion_tokens ?? 0),
            durationMs: duration,
            ttftMs: ttft !== null && ttft >= 0 ? ttft : null,
            tags,
            error: status === 'failure' ? errorText(meta.error_information ?? meta.error) : null,
          });
        }
        if (rows.length < pageSize) break;
      }
      return out;
    },
  };
}
