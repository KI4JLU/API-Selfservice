export interface LiteLLMModel {
  /** public model name (what the key uses) */
  modelName: string;
  /** deployment id in LiteLLM */
  modelId: string | null;
  /** litellm provider, e.g. openai, anthropic, vertex_ai */
  provider: string | null;
  /** price per input token (from LiteLLM model_info), null when LiteLLM has no price */
  inputCostPerToken: number | null;
  /** price per output token (from LiteLLM model_info), null when LiteLLM has no price */
  outputCostPerToken: number | null;
}

export interface LiteLLMKey {
  /** token / key id used for update/delete (hashed token) */
  keyId: string;
  /** plaintext, only on create */
  secret?: string;
  alias: string;
  models: string[];
  maxBudget: number | null;
  expires: string | null;
  blocked: boolean;
  spend: number;
  /** LiteLLM team (= API-Selfservice cost center id), null for keys without a team */
  teamId: string | null;
}

/**
 * A user record in LiteLLM. LiteLLM is the user master (PRD E-7): `userId` is the same
 * value as the API-Selfservice user id, so no mapping table is needed.
 */
export interface LiteLLMUser {
  userId: string;
  email: string | null;
  alias: string | null;
  /** Keycloak subject, stored as LiteLLM `sso_user_id` */
  ssoUserId: string | null;
  maxBudget: number | null;
  spend: number;
  blocked: boolean;
  /** team ids the user belongs to (= API-Selfservice cost center ids) */
  teams: string[];
}

/** A LiteLLM team. One team per cost center (PRD E-8); `teamId` equals the API-Selfservice cost center id. */
export interface LiteLLMTeam {
  teamId: string;
  alias: string;
  maxBudget: number | null;
  budgetDuration: string | null;
  blocked: boolean;
  spend: number;
}

export type TeamRole = 'admin' | 'user';

export interface LiteLLMSpendLog {
  requestId: string;
  sessionId: string | null;
  startTime: string;
  endTime: string | null;
  callType: string;
  status: 'success' | 'failure';
  model: string;
  provider: string | null;
  apiKey: string; // hashed key token
  litellmUserId: string | null;
  spend: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number | null;
  ttftMs: number | null;
  tags: string[];
  error: string | null;
}

export interface LiteLLMAdapter {
  readonly mode: 'http' | 'mock';
  health(): Promise<{ ok: boolean; detail?: string }>;

  // ---- Users. LiteLLM is the user master; API-Selfservice never invents a second identity.
  getUser(userId: string): Promise<LiteLLMUser | null>;
  /**
   * Paginated user list. `email` narrows to an exact (case-insensitive) match;
   * `search` is a substring match on the e-mail, or a full user id.
   */
  listUsers(q: { page: number; pageSize: number; email?: string; search?: string }): Promise<{ items: LiteLLMUser[]; total: number }>;
  createUser(input: { userId: string; email: string; alias?: string; ssoUserId?: string | null }): Promise<{ litellmUserId: string }>;
  updateUser(userId: string, patch: { email?: string; alias?: string; ssoUserId?: string | null }): Promise<void>;
  updateUserBudget(userId: string, input: { maxBudget: number | null; budgetDuration: string | null }): Promise<void>;
  blockUser(userId: string, blocked: boolean): Promise<void>;

  // ---- Teams = cost centers. Budgets and blocks are mirrored here so LiteLLM enforces them natively.
  getTeam(teamId: string): Promise<LiteLLMTeam | null>;
  createTeam(input: {
    teamId: string;
    alias: string;
    maxBudget: number | null;
    budgetDuration: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ teamId: string }>;
  updateTeam(teamId: string, patch: { alias?: string; maxBudget?: number | null; budgetDuration?: string | null }): Promise<void>;
  setTeamBlocked(teamId: string, blocked: boolean): Promise<void>;
  /** Adds the user to the team or changes their role; idempotent. */
  setTeamMember(teamId: string, userId: string, role: TeamRole): Promise<void>;
  /** Removes the user from the team; a no-op when they are not a member. */
  removeTeamMember(teamId: string, userId: string): Promise<void>;

  // ---- Keys
  createKey(input: {
    litellmUserId: string;
    teamId: string | null;
    alias: string;
    models: string[];
    maxBudget: number | null;
    expiresAt: Date;
    metadata?: Record<string, unknown>;
  }): Promise<LiteLLMKey & { secret: string }>;
  updateKey(
    keyId: string,
    patch: { models?: string[]; maxBudget?: number | null; expiresAt?: Date; blocked?: boolean; alias?: string },
  ): Promise<void>;
  deleteKey(keyId: string): Promise<void>;
  listModels(): Promise<LiteLLMModel[]>;

  // ---- Key test (F-KEY-9). These calls authenticate with the user's key, not with the master key.
  /** Model names the key may call (`/v1/models`). */
  listKeyModels(secret: string): Promise<string[]>;
  /** One short chat completion with the key (`/v1/chat/completions`). */
  chatWithKey(
    secret: string,
    input: { model: string; prompt: string; maxTokens: number },
  ): Promise<{ model: string; answer: string; promptTokens: number | null; completionTokens: number | null }>;
  /** Spend logs in [since, until). Implementations page internally. */
  getSpendLogs(since: Date, until: Date): Promise<LiteLLMSpendLog[]>;
}

/** API-Selfservice budget period -> LiteLLM `budget_duration`. Project budgets have no reset; API-Selfservice watches their end date. */
export function budgetDurationFor(period: 'monthly' | 'yearly' | 'project' | null | undefined): string | null {
  return period === 'monthly' ? '30d' : period === 'yearly' ? '365d' : null;
}

export class LiteLLMHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(`LiteLLM ${path} -> ${status}: ${body.slice(0, 300)}`);
  }
}
