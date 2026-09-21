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

function mapTeam(r: Raw): LiteLLMTeam {
  return {
    teamId: String(r.team_id),
    alias: String(r.team_alias ?? ''),
    maxBudget: r.max_budget == null ? null : Number(r.max_budget),
    budgetDuration: (r.budget_duration as string | null) ?? null,
    blocked: Boolean(r.blocked ?? false),
    spend: Number(r.spend ?? 0),
  };
}

const isNotFound = (e: unknown) =>
  e instanceof LiteLLMHttpError && (e.status === 404 || (e.status === 400 && /not found|does not exist/i.test(e.body)));

/**
 * REST adapter for the LiteLLM proxy. Uses the documented admin endpoints:
 * /user/{new,update,info,list}, /team/{new,update,info,block,unblock,member_add,member_update,member_delete},
 * /key/{generate,update,delete}, /model/info, /spend/logs.
 */
export function createHttpAdapter(opts: Opts): LiteLLMAdapter {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await f(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
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
        const res = await f(`${base}/health/readiness`);
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
      const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (email) qs.set('user_email', email);
      else if (search && UUID_RE.test(search)) qs.set('user_ids', search);
      else if (search) qs.set('user_email', search); // LiteLLM filters case-insensitively by substring
      const r = await call<{ users?: Raw[]; total?: number }>('GET', `/user/list?${qs.toString()}`);
      let items = (r.users ?? []).map(mapUser);
      if (email) items = items.filter((u) => u.email?.toLowerCase() === email.toLowerCase());
      return { items, total: email ? items.length : Number(r.total ?? items.length) };
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
    async createTeam({ teamId, alias, maxBudget, budgetDuration, metadata }) {
      const r = await call<{ team_id?: string }>('POST', '/team/new', {
        team_id: teamId,
        team_alias: alias,
        max_budget: maxBudget,
        budget_duration: toDuration(budgetDuration),
        metadata: metadata ?? {},
      });
      return { teamId: r.team_id ?? teamId };
    },
    async updateTeam(teamId, patch) {
      const body: Raw = { team_id: teamId };
      if (patch.alias !== undefined) body.team_alias = patch.alias;
      if (patch.maxBudget !== undefined) body.max_budget = patch.maxBudget;
      if (patch.budgetDuration !== undefined) body.budget_duration = toDuration(patch.budgetDuration);
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
    async createKey({ litellmUserId, teamId, alias, models, maxBudget, expiresAt, metadata }) {
      const r = await call<{
        key: string;
        token?: string;
        token_id?: string;
        key_alias?: string;
        models?: string[];
        max_budget?: number | null;
        expires?: string | null;
        team_id?: string | null;
      }>('POST', '/key/generate', {
        user_id: litellmUserId,
        ...(teamId ? { team_id: teamId } : {}),
        key_alias: alias,
        models,
        max_budget: maxBudget,
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
    async getSpendLogs(since, until) {
      // /spend/logs supports start_date/end_date (YYYY-MM-DD). We over-fetch by day and filter.
      const start = since.toISOString().slice(0, 10);
      const end = until.toISOString().slice(0, 10);
      const rows = await call<Array<Record<string, unknown>>>('GET', `/spend/logs?start_date=${start}&end_date=${end}`);
      const out: LiteLLMSpendLog[] = [];
      for (const r of rows ?? []) {
        const startTime = String(r.startTime ?? r.start_time ?? '');
        const t = new Date(startTime);
        if (Number.isNaN(t.getTime()) || t < since || t >= until) continue;
        const endTime = r.endTime ? String(r.endTime) : null;
        const meta = (r.metadata as Record<string, unknown> | undefined) ?? {};
        const status = String(meta.status ?? r.status ?? 'success') === 'failure' ? 'failure' : 'success';
        const tags = Array.isArray(r.request_tags) ? (r.request_tags as string[]) : [];
        const duration = endTime ? new Date(endTime).getTime() - t.getTime() : null;
        const ttft = typeof r.completionStartTime === 'string' ? new Date(r.completionStartTime).getTime() - t.getTime() : null;
        out.push({
          requestId: String(r.request_id),
          sessionId: (r.session_id as string | null) ?? null,
          startTime: t.toISOString(),
          endTime,
          callType: String(r.call_type ?? 'llm'),
          status,
          model: String(r.model ?? ''),
          provider: (r.custom_llm_provider as string | null) ?? null,
          apiKey: String(r.api_key ?? ''),
          litellmUserId: (r.user as string | null) ?? null,
          spend: Number(r.spend ?? 0),
          promptTokens: Number(r.prompt_tokens ?? 0),
          completionTokens: Number(r.completion_tokens ?? 0),
          durationMs: duration,
          ttftMs: ttft !== null && ttft >= 0 ? ttft : null,
          tags,
          error: status === 'failure' ? String(meta.error_information ?? meta.error ?? '') || null : null,
        });
      }
      return out;
    },
  };
}
