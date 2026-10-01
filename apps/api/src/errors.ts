import type { ErrorCode } from '@api-selfservice/shared';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CSRF_ORIGIN_MISMATCH: 403,
  ACCOUNT_DEACTIVATED: 403,
  ACCOUNT_INVALID_AFFILIATION: 403,
  COST_CENTER_NOT_APPROVED: 409,
  COST_CENTER_EXISTS: 409,
  COST_CENTER_DEFAULT_IMMUTABLE: 409,
  COST_CENTER_REQUEST_PENDING: 409,
  COST_CENTER_NOT_MEMBER: 409,
  COST_CENTER_MEMBER_EXISTS: 409,
  COST_CENTER_OWNER_ONLY: 403,
  COST_CENTER_OWNER_MUST_BE_ADMIN: 409,
  OWNER_NOT_LITELLM_USER: 409,
  USER_DEACTIVATED: 409,
  PAID_MODEL_REQUIRES_COST_CENTER: 409,
  MODEL_NOT_ALLOWED: 409,
  KEY_BUDGET_EXCEEDS_USER_BUDGET: 409,
  KEY_NOT_ACTIVE: 409,
  KEY_INVALID: 422,
  KEY_TEST_FAILED: 502,
  LAST_ADMIN: 409,
  ROLE_MANAGED_BY_IDP: 409,
  SELF_DEACTIVATION: 409,
  LITELLM_ERROR: 502,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
    this.status = STATUS[code];
  }
  toBody() {
    return { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) };
  }
}

export const notFound = (what = 'Resource') => new ApiError('NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'Forbidden') => new ApiError('FORBIDDEN', msg);
