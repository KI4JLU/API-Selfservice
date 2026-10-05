import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3030),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:3030'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  DB_SCHEMA: z.string().default('api_selfservice'),

  AUTH_SECRET: z.string().min(16),

  KEYCLOAK_ISSUER: z.string().url().optional(),
  KEYCLOAK_CLIENT_ID: z.string().optional(),
  KEYCLOAK_CLIENT_SECRET: z.string().optional(),
  KEYCLOAK_ADMIN_GROUP: z.string().default('LiteLLMAdmin'),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().optional(),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().optional(),
  KEYCLOAK_GROUPS_CLAIM: z.string().default('groups'),
  KEYCLOAK_AFFILIATION_CLAIM: z.string().default('eduPersonAffiliation'),
  KEYCLOAK_AFFILIATION_VALID: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  LITELLM_BASE_URL: z.string().url().default('http://localhost:4000'),
  LITELLM_API_KEY: z.string().default(''),
  LITELLM_MODE: z.enum(['http', 'mock']).default('http'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('API-Selfservice <noreply@localhost>'),
  ADMIN_NOTIFY_EMAILS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  KEY_LIFETIME_DAYS: z.coerce.number().default(182),
  DELETION_GRACE_DAYS: z.coerce.number().default(365),
  BUDGET_WARN_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  JOBS_ENABLED: bool,
  LOG_INGEST_CRON: z.string().default('*/5 * * * *'),
  AFFILIATION_CHECK_CRON: z.string().default('0 3 * * *'),

  DEV_LOGIN_ENABLED: bool,
  /** Admins may act as another user for debugging (POST /admin/users/{id}/impersonate). Off by default. */
  IMPERSONATION_ENABLED: bool,
  /** OpenAPI spec and docs only for signed-in admins. Always on in production (PRD 7.1), optional elsewhere (e.g. staging). */
  API_DOCS_ADMIN_ONLY: bool,
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.DEV_LOGIN_ENABLED) {
    throw new Error('DEV_LOGIN_ENABLED must not be set in production');
  }
  if (env.NODE_ENV === 'production' && env.LITELLM_MODE === 'mock') {
    throw new Error('LITELLM_MODE=mock is not allowed in production');
  }
  return env;
}
