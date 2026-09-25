import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const SCHEMA_NAME = process.env.DB_SCHEMA ?? 'api_selfservice';
export const apiSelfservice = pgSchema(SCHEMA_NAME);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 14, scale: 6 });
/** per-token prices are tiny (e.g. 0.0000025), so they need more decimals than money */
const perToken = (name: string) => numeric(name, { precision: 20, scale: 12 });
const id = () => text('id').primaryKey().default(sql`gen_random_uuid()::text`);

// ---------- Better Auth core tables (names/fields required by better-auth) ----------
// `user.id` is shared with LiteLLM (`user_id`); the Keycloak subject lives in `account.account_id`.

export const user = apiSelfservice.table(
  'user',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    // ---- API-Selfservice fields ----
    role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
    roleFromIdp: boolean('role_from_idp').notNull().default(false),
    locale: text('locale', { enum: ['de', 'en'] }).notNull().default('de'),
    affiliation: text('affiliation').array(),
    affiliationValid: boolean('affiliation_valid').notNull().default(true),
    costCenterId: text('cost_center_id'),
    costCenterOwnerName: text('cost_center_owner_name'),
    costCenterOwnerEmail: text('cost_center_owner_email'),
    deletedAt: ts('deleted_at'),
    deletedReason: text('deleted_reason', { enum: ['admin', 'affiliation'] }),
    lastLoginAt: ts('last_login_at'),
  },
  (t) => [uniqueIndex('user_email_idx').on(t.email), index('user_cost_center_idx').on(t.costCenterId)],
);

export const session = apiSelfservice.table(
  'session',
  {
    id: id(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Admin impersonation for debugging: while set, requests on this session act as this user. */
    impersonatedUserId: text('impersonated_user_id').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('session_token_idx').on(t.token), index('session_user_idx').on(t.userId)],
);

export const account = apiSelfservice.table(
  'account',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = apiSelfservice.table(
  'verification',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

// ---------- Domain tables ----------

export const costCenters = apiSelfservice.table(
  'cost_centers',
  {
    id: id(),
    number: text('number').notNull(),
    name: text('name').notNull(),
    ownerName: text('owner_name').notNull(),
    ownerEmail: text('owner_email').notNull(),
    maxBudget: money('max_budget'),
    budgetPeriod: text('budget_period', { enum: ['monthly', 'yearly', 'project'] }),
    periodStart: ts('period_start'),
    periodEnd: ts('period_end'),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'archived'] }).notNull().default('pending'),
    isDefault: boolean('is_default').notNull().default(false),
    /** LiteLLM team backing this cost center (team_id = cost center id); null until created. */
    litellmTeamId: text('litellm_team_id'),
    blockedAt: ts('blocked_at'),
    requestedBy: text('requested_by'),
    approvedBy: text('approved_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cost_center_number_idx').on(t.number), index('cost_center_status_idx').on(t.status)],
);

export const costCenterRequests = apiSelfservice.table(
  'cost_center_requests',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    costCenterId: text('cost_center_id')
      .notNull()
      .references(() => costCenters.id),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
    reason: text('reason'),
    decidedBy: text('decided_by'),
    decidedAt: ts('decided_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('ccr_user_idx').on(t.userId), index('ccr_status_idx').on(t.status)],
);

export const costCenterAdmins = apiSelfservice.table(
  'cost_center_admins',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    costCenterId: text('cost_center_id')
      .notNull()
      .references(() => costCenters.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by'),
    assignedAt: ts('assigned_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.costCenterId] })],
);

export const apiKeys = apiSelfservice.table(
  'api_keys',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    litellmKeyId: text('litellm_key_id').notNull(),
    keyHash: text('key_hash'),
    maskedKey: text('masked_key').notNull(),
    name: text('name').notNull(),
    costCenterId: text('cost_center_id')
      .notNull()
      .references(() => costCenters.id),
    models: text('models').array().notNull().default(sql`'{}'::text[]`),
    budget: money('budget'),
    status: text('status', { enum: ['active', 'expired', 'blocked', 'deleted'] }).notNull().default('active'),
    blockedReason: text('blocked_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    lastExtendedAt: ts('last_extended_at'),
    notified14d: boolean('notified_14d').notNull().default(false),
    notified1d: boolean('notified_1d').notNull().default(false),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('api_key_litellm_idx').on(t.litellmKeyId),
    index('api_key_user_idx').on(t.userId),
    index('api_key_cc_idx').on(t.costCenterId),
  ],
);

export const providers = apiSelfservice.table(
  'providers',
  {
    id: id(),
    modelName: text('model_name').notNull(),
    litellmModelId: text('litellm_model_id'),
    provider: text('provider'),
    tier: text('tier', { enum: ['free', 'paid'] }).notNull().default('paid'),
    displayNameDe: text('display_name_de'),
    displayNameEn: text('display_name_en'),
    descriptionDe: text('description_de'),
    descriptionEn: text('description_en'),
    inputCostPerToken: perToken('input_cost_per_token'),
    outputCostPerToken: perToken('output_cost_per_token'),
    available: boolean('available').notNull().default(true),
    lastSeenAt: ts('last_seen_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('provider_model_name_idx').on(t.modelName)],
);

export const budgets = apiSelfservice.table('budgets', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .unique(),
  amount: money('amount').notNull(),
  period: text('period', { enum: ['monthly', 'yearly', 'project'] }).notNull().default('monthly'),
  periodStart: ts('period_start'),
  periodEnd: ts('period_end'),
  blockedAt: ts('blocked_at'),
  notified80At: ts('notified_80_at'),
  notified100At: ts('notified_100_at'),
  assignedBy: text('assigned_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Request metadata ingested from LiteLLM spend logs. No prompt/response content. */
export const requestLogs = apiSelfservice.table(
  'request_logs',
  {
    requestId: text('request_id').primaryKey(),
    sessionId: text('session_id'),
    userId: text('user_id'),
    litellmUserId: text('litellm_user_id'),
    apiKeyId: text('api_key_id'),
    litellmKeyId: text('litellm_key_id'),
    costCenterId: text('cost_center_id'),
    time: ts('time').notNull(),
    endTime: ts('end_time'),
    type: text('type').notNull().default('llm'),
    status: text('status', { enum: ['success', 'failure'] }).notNull(),
    model: text('model').notNull(),
    provider: text('provider'),
    cost: money('cost').notNull().default('0'),
    durationMs: integer('duration_ms'),
    ttftMs: integer('ttft_ms'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    error: text('error'),
    ingestedAt: ts('ingested_at').notNull().defaultNow(),
  },
  (t) => [
    index('rl_user_time_idx').on(t.userId, t.time),
    index('rl_cc_time_idx').on(t.costCenterId, t.time),
    index('rl_key_idx').on(t.apiKeyId),
    index('rl_time_idx').on(t.time),
  ],
);

export const spendSnapshots = apiSelfservice.table(
  'spend_snapshots',
  {
    id: id(),
    date: text('date').notNull(), // YYYY-MM-DD
    userId: text('user_id'),
    apiKeyId: text('api_key_id'),
    costCenterId: text('cost_center_id'),
    model: text('model').notNull(),
    provider: text('provider'),
    spend: money('spend').notNull().default('0'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    requestCount: integer('request_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('snap_unique_idx').on(t.date, t.userId, t.apiKeyId, t.costCenterId, t.model),
    index('snap_cc_date_idx').on(t.costCenterId, t.date),
    index('snap_user_date_idx').on(t.userId, t.date),
  ],
);

export const rebookings = apiSelfservice.table('rebookings', {
  id: id(),
  periodStart: ts('period_start').notNull(),
  periodEnd: ts('period_end').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  filePath: text('file_path'),
  rowCount: integer('row_count').notNull().default(0),
  totalAmount: money('total_amount').notNull().default('0'),
});

export const notifications = apiSelfservice.table(
  'notifications',
  {
    id: id(),
    userId: text('user_id'),
    type: text('type').notNull(),
    recipient: text('recipient').notNull(),
    locale: text('locale').notNull().default('de'),
    subject: text('subject').notNull(),
    status: text('status', { enum: ['sent', 'failed', 'skipped'] }).notNull(),
    error: text('error'),
    sentAt: ts('sent_at').notNull().defaultNow(),
  },
  (t) => [index('notif_user_idx').on(t.userId), index('notif_type_idx').on(t.type)],
);

/** Admin event log: major changes (info), alerts such as exhausted budgets (warning) and failures (error). */
export const auditLog = apiSelfservice.table(
  'audit_log',
  {
    id: id(),
    actorId: text('actor_id'),
    severity: text('severity', { enum: ['info', 'warning', 'error'] }).notNull().default('info'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    payload: jsonb('payload'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entity, t.entityId),
    index('audit_created_idx').on(t.createdAt),
    index('audit_severity_created_idx').on(t.severity, t.createdAt),
  ],
);

/** Key/value state for jobs (e.g. last ingested log timestamp). */
export const jobState = apiSelfservice.table('job_state', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const schema = {
  user,
  session,
  account,
  verification,
  costCenters,
  costCenterRequests,
  costCenterAdmins,
  apiKeys,
  providers,
  budgets,
  requestLogs,
  spendSnapshots,
  rebookings,
  notifications,
  auditLog,
  jobState,
};
