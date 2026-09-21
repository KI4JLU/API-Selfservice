export const DEFAULT_COST_CENTER = '11111111';
export const COST_CENTER_LENGTH = 8;

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Effective role as seen by the API (cost_center_admin is derived from assignments). */
export const EFFECTIVE_ROLES = ['user', 'cost_center_admin', 'admin'] as const;
export type EffectiveRole = (typeof EFFECTIVE_ROLES)[number];

export const COST_CENTER_STATUS = ['pending', 'approved', 'rejected', 'archived'] as const;
export type CostCenterStatus = (typeof COST_CENTER_STATUS)[number];

export const BUDGET_PERIODS = ['monthly', 'yearly', 'project'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const PROVIDER_TIERS = ['free', 'paid'] as const;
export type ProviderTier = (typeof PROVIDER_TIERS)[number];

export const KEY_STATUS = ['active', 'expired', 'blocked', 'deleted'] as const;
export type KeyStatus = (typeof KEY_STATUS)[number];

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const NOTIFICATION_TYPES = [
  'cost_center_request_created',
  'cost_center_request_approved',
  'cost_center_request_rejected',
  'user_budget_80',
  'user_budget_100',
  'cost_center_budget_80',
  'cost_center_budget_100',
  'key_expires_14d',
  'key_expires_1d',
  'key_expired',
  'budget_exhausted_keys_blocked',
  'account_invalid_deactivated',
  'user_deactivated',
  'deletion_due',
  'role_changed',
  'rebooking_created',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const BUDGET_WARN_THRESHOLD = 0.8;
export const DEFAULT_KEY_LIFETIME_DAYS = 182;
export const DEFAULT_DELETION_GRACE_DAYS = 365;

/** Event log (audit_log): info = change, warning = alert (e.g. budget exhausted), error = failure. */
export const AUDIT_SEVERITIES = ['info', 'warning', 'error'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

/** Entity kinds that appear in the event log (`request` = an API request, `job` = a cron job). */
export const AUDIT_ENTITIES = ['user', 'api_key', 'cost_center', 'provider', 'request', 'job'] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];
