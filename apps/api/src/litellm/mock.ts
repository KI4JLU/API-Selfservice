import { randomBytes, createHash } from 'node:crypto';
import type { LiteLLMAdapter, LiteLLMKey, LiteLLMModel, LiteLLMSpendLog, LiteLLMUser, TeamRole } from './types.js';
import { LiteLLMHttpError } from './types.js';

export interface MockUser {
  email: string;
  alias: string | null;
  ssoUserId: string | null;
  maxBudget: number | null;
  blocked: boolean;
  teams: Set<string>;
}

export interface MockTeam {
  alias: string;
  maxBudget: number | null;
  budgetDuration: string | null;
  models: string[];
  blocked: boolean;
  members: Map<string, TeamRole>;
}

/**
 * In-memory LiteLLM. Generates synthetic spend logs for existing keys so that
 * dashboards, budgets and logs can be developed and tested without a proxy.
 */
export function createMockAdapter(opts: { seedLogs?: boolean; now?: () => Date } = {}): LiteLLMAdapter & {
  keys: Map<string, LiteLLMKey & { userId: string }>;
  users: Map<string, MockUser>;
  teams: Map<string, MockTeam>;
  logs: LiteLLMSpendLog[];
  models: LiteLLMModel[];
  addLog(log: Partial<LiteLLMSpendLog> & { apiKey: string }): LiteLLMSpendLog;
} {
  const now = opts.now ?? (() => new Date());
  const keys = new Map<string, LiteLLMKey & { userId: string }>();
  const users = new Map<string, MockUser>();
  const teams = new Map<string, MockTeam>();
  const logs: LiteLLMSpendLog[] = [];
  const models: LiteLLMModel[] = [
    { modelName: 'gpt-4o-mini', modelId: 'm-gpt4o-mini', provider: 'openai', inputCostPerToken: 0.00000015, outputCostPerToken: 0.0000006 },
    { modelName: 'gpt-4o', modelId: 'm-gpt4o', provider: 'openai', inputCostPerToken: 0.0000025, outputCostPerToken: 0.00001 },
    { modelName: 'claude-sonnet-5', modelId: 'm-claude-sonnet', provider: 'anthropic', inputCostPerToken: 0.000003, outputCostPerToken: 0.000015 },
    { modelName: 'claude-opus-5', modelId: 'm-claude-opus', provider: 'anthropic', inputCostPerToken: 0.000015, outputCostPerToken: 0.000075 },
    { modelName: 'gemma-local', modelId: 'm-gemma', provider: 'hosted_vllm', inputCostPerToken: null, outputCostPerToken: null },
  ];
  let seq = 0;

  const ensureUser = (id: string): MockUser => {
    const u = users.get(id) ?? { email: '', alias: null, ssoUserId: null, maxBudget: null, blocked: false, teams: new Set<string>() };
    users.set(id, u);
    return u;
  };
  const toUser = (id: string, u: MockUser): LiteLLMUser => ({
    userId: id,
    email: u.email || null,
    alias: u.alias,
    ssoUserId: u.ssoUserId,
    maxBudget: u.maxBudget,
    spend: [...keys.values()].filter((k) => k.userId === id).reduce((a, k) => a + k.spend, 0),
    blocked: u.blocked,
    teams: [...u.teams],
  });

  /** Like LiteLLM: unknown, blocked and expired keys are rejected with 401. */
  const keyBySecret = (secret: string, path: string) => {
    const k = keys.get(createHash('sha256').update(secret).digest('hex'));
    if (!k || k.blocked || (k.expires && new Date(k.expires) <= now())) throw new LiteLLMHttpError(401, 'Authentication Error', path);
    return k;
  };

  function addLog(partial: Partial<LiteLLMSpendLog> & { apiKey: string }): LiteLLMSpendLog {
    const t = partial.startTime ? new Date(partial.startTime) : now();
    const k = keys.get(partial.apiKey);
    const log: LiteLLMSpendLog = {
      requestId: partial.requestId ?? `chatcmpl-mock-${++seq}-${randomBytes(3).toString('hex')}`,
      sessionId: partial.sessionId ?? null,
      startTime: t.toISOString(),
      endTime: partial.endTime ?? new Date(t.getTime() + (partial.durationMs ?? 1200)).toISOString(),
      callType: partial.callType ?? 'acompletion',
      status: partial.status ?? 'success',
      model: partial.model ?? (k?.models[0] ?? 'gpt-4o-mini'),
      provider: partial.provider ?? models.find((m) => m.modelName === (partial.model ?? k?.models[0]))?.provider ?? 'openai',
      apiKey: partial.apiKey,
      litellmUserId: partial.litellmUserId ?? k?.userId ?? null,
      spend: partial.spend ?? Number((Math.random() * 0.05).toFixed(6)),
      promptTokens: partial.promptTokens ?? Math.floor(200 + Math.random() * 2000),
      completionTokens: partial.completionTokens ?? Math.floor(50 + Math.random() * 800),
      durationMs: partial.durationMs ?? Math.floor(300 + Math.random() * 8000),
      ttftMs: partial.ttftMs ?? Math.floor(50 + Math.random() * 800),
      tags: partial.tags ?? [],
      error: partial.error ?? null,
    };
    logs.push(log);
    if (k) k.spend += log.spend;
    return log;
  }

  return {
    mode: 'mock',
    keys,
    users,
    teams,
    logs,
    models,
    addLog,
    async health() {
      return { ok: true, detail: 'mock' };
    },

    // ---------- users ----------
    async getUser(id) {
      const u = users.get(id);
      return u ? toUser(id, u) : null;
    },
    async listUsers({ page, pageSize, email, search }) {
      const needle = search?.toLowerCase();
      const all = [...users.entries()]
        .filter(([, u]) => !email || u.email.toLowerCase() === email.toLowerCase())
        .filter(([id, u]) => !needle || id.toLowerCase() === needle || u.email.toLowerCase().includes(needle) || (u.alias ?? '').toLowerCase().includes(needle))
        .map(([id, u]) => toUser(id, u));
      return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length };
    },
    async createUser({ userId, email, alias, ssoUserId }) {
      const u = ensureUser(userId);
      u.email = email;
      u.alias = alias ?? email;
      u.ssoUserId = ssoUserId ?? null;
      return { litellmUserId: userId };
    },
    async updateUser(id, patch) {
      const u = ensureUser(id);
      if (patch.email !== undefined) u.email = patch.email;
      if (patch.alias !== undefined) u.alias = patch.alias;
      if (patch.ssoUserId !== undefined) u.ssoUserId = patch.ssoUserId;
    },
    async updateUserBudget(id, { maxBudget }) {
      ensureUser(id).maxBudget = maxBudget;
    },
    async blockUser(id, blocked) {
      ensureUser(id).blocked = blocked;
    },

    // ---------- teams ----------
    async getTeam(teamId) {
      const t = teams.get(teamId);
      if (!t) return null;
      const spend = [...keys.values()].filter((k) => k.teamId === teamId).reduce((a, k) => a + k.spend, 0);
      return { teamId, alias: t.alias, maxBudget: t.maxBudget, budgetDuration: t.budgetDuration, models: [...t.models], blocked: t.blocked, spend };
    },
    async createTeam({ teamId, alias, maxBudget, budgetDuration, models: ms }) {
      if (teams.has(teamId)) throw new Error(`mock: team ${teamId} exists`);
      teams.set(teamId, { alias, maxBudget, budgetDuration, models: ms ?? [], blocked: false, members: new Map() });
      return { teamId };
    },
    async updateTeam(teamId, patch) {
      const t = teams.get(teamId);
      if (!t) throw new Error(`mock: team ${teamId} not found`);
      if (patch.alias !== undefined) t.alias = patch.alias;
      if (patch.maxBudget !== undefined) t.maxBudget = patch.maxBudget;
      if (patch.budgetDuration !== undefined) t.budgetDuration = patch.budgetDuration;
      if (patch.models !== undefined) t.models = patch.models;
    },
    async setTeamBlocked(teamId, blocked) {
      const t = teams.get(teamId);
      if (!t) throw new Error(`mock: team ${teamId} not found`);
      t.blocked = blocked;
    },
    async setTeamMember(teamId, userId, role) {
      const t = teams.get(teamId);
      if (!t) throw new Error(`mock: team ${teamId} not found`);
      t.members.set(userId, role);
      ensureUser(userId).teams.add(teamId);
    },
    async removeTeamMember(teamId, userId) {
      teams.get(teamId)?.members.delete(userId);
      users.get(userId)?.teams.delete(teamId);
    },

    // ---------- keys ----------
    async createKey({ litellmUserId, teamId, alias, models: ms, maxBudget, budgetDuration, expiresAt }) {
      const secret = `sk-${randomBytes(24).toString('hex')}`;
      const keyId = createHash('sha256').update(secret).digest('hex');
      const k = { keyId, alias, models: ms, maxBudget, budgetDuration, expires: expiresAt.toISOString(), blocked: false, spend: 0, teamId, userId: litellmUserId };
      keys.set(keyId, k);
      if (opts.seedLogs) {
        // A few synthetic requests over the last days for demo purposes.
        for (let i = 0; i < 12; i++) {
          const t = new Date(now().getTime() - Math.floor(Math.random() * 6) * 86400000 - Math.random() * 3600000);
          addLog({ apiKey: keyId, startTime: t.toISOString(), model: ms[i % ms.length], status: i % 7 === 6 ? 'failure' : 'success' });
        }
      }
      return { ...k, secret };
    },
    async updateKey(keyId, patch) {
      const k = keys.get(keyId);
      if (!k) throw new Error(`mock: key ${keyId} not found`);
      if (patch.models) k.models = patch.models;
      if (patch.maxBudget !== undefined) k.maxBudget = patch.maxBudget;
      if (patch.budgetDuration !== undefined) k.budgetDuration = patch.budgetDuration;
      if (patch.alias !== undefined) k.alias = patch.alias;
      if (patch.blocked !== undefined) k.blocked = patch.blocked;
      if (patch.expiresAt) k.expires = patch.expiresAt.toISOString();
    },
    async deleteKey(keyId) {
      keys.delete(keyId);
    },
    async listModels() {
      return models;
    },
    async listKeyModels(secret) {
      return [...keyBySecret(secret, '/v1/models').models];
    },
    async chatWithKey(secret, { model, prompt }) {
      const k = keyBySecret(secret, '/v1/chat/completions');
      if (!k.models.includes(model)) throw new LiteLLMHttpError(401, 'key not allowed to access model', '/v1/chat/completions');
      // Like LiteLLM: team models restrict every key of the team (F-KST-15).
      const team = k.teamId ? teams.get(k.teamId) : undefined;
      if (team && team.models.length > 0 && !team.models.includes(model)) throw new LiteLLMHttpError(401, 'team not allowed to access model', '/v1/chat/completions');
      const promptTokens = Math.ceil(prompt.length / 4);
      const completionTokens = 8;
      addLog({ apiKey: k.keyId, model, promptTokens, completionTokens });
      return { model, answer: `Mock answer from ${model}.`, promptTokens, completionTokens };
    },
    async getSpendLogs(since, until) {
      return logs.filter((l) => {
        const t = new Date(l.startTime);
        return t >= since && t < until;
      });
    },
  };
}
