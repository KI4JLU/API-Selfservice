import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const minimal = { DATABASE_URL: 'postgres://u:p@localhost:5433/db', AUTH_SECRET: 'x'.repeat(32) };

describe('loadEnv', () => {
  it('applies defaults', () => {
    const e = loadEnv(minimal);
    expect(e.NODE_ENV).toBe('development');
    expect(e.PORT).toBe(3030);
    expect(e.APP_URL).toBe('http://localhost:5173');
    expect(e.API_URL).toBe('http://localhost:3030');
    expect(e.DB_SCHEMA).toBe('api_selfservice');
    expect(e.LITELLM_MODE).toBe('http');
    expect(e.LITELLM_BASE_URL).toBe('http://localhost:4000');
    expect(e.KEYCLOAK_ADMIN_GROUP).toBe('LiteLLMAdmin');
    expect(e.KEYCLOAK_GROUPS_CLAIM).toBe('groups');
    expect(e.KEYCLOAK_AFFILIATION_CLAIM).toBe('eduPersonAffiliation');
    expect(e.KEYCLOAK_AFFILIATION_VALID).toEqual([]);
    expect(e.ADMIN_NOTIFY_EMAILS).toEqual([]);
    expect(e.KEY_LIFETIME_DAYS).toBe(182);
    expect(e.DELETION_GRACE_DAYS).toBe(365);
    expect(e.BUDGET_WARN_THRESHOLD).toBe(0.8);
    expect(e.JOBS_ENABLED).toBe(false);
    expect(e.DEV_LOGIN_ENABLED).toBe(false);
    expect(e.SMTP_SECURE).toBe(false);
    expect(e.SMTP_PORT).toBe(1025);
    expect(e.LOG_INGEST_CRON).toBe('*/5 * * * *');
  });

  it('parses booleans, numbers and lists', () => {
    const e = loadEnv({
      ...minimal,
      JOBS_ENABLED: '1',
      DEV_LOGIN_ENABLED: 'true',
      SMTP_SECURE: 'false',
      PORT: '8080',
      KEY_LIFETIME_DAYS: '30',
      BUDGET_WARN_THRESHOLD: '0.5',
      KEYCLOAK_AFFILIATION_VALID: ' member , staff,,',
      ADMIN_NOTIFY_EMAILS: 'a@x.de, b@x.de',
    });
    expect(e.JOBS_ENABLED).toBe(true);
    expect(e.DEV_LOGIN_ENABLED).toBe(true);
    expect(e.SMTP_SECURE).toBe(false);
    expect(e.PORT).toBe(8080);
    expect(e.KEY_LIFETIME_DAYS).toBe(30);
    expect(e.BUDGET_WARN_THRESHOLD).toBe(0.5);
    expect(e.KEYCLOAK_AFFILIATION_VALID).toEqual(['member', 'staff']);
    expect(e.ADMIN_NOTIFY_EMAILS).toEqual(['a@x.de', 'b@x.de']);
  });

  it('rejects missing DATABASE_URL and short AUTH_SECRET', () => {
    expect(() => loadEnv({ AUTH_SECRET: 'x'.repeat(32) })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL: 'postgres://x', AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });

  it('rejects invalid enum values and thresholds', () => {
    expect(() => loadEnv({ ...minimal, LITELLM_MODE: 'fake' })).toThrow(/LITELLM_MODE/);
    expect(() => loadEnv({ ...minimal, BUDGET_WARN_THRESHOLD: '1.5' })).toThrow(/BUDGET_WARN_THRESHOLD/);
    expect(() => loadEnv({ ...minimal, APP_URL: 'not-a-url' })).toThrow(/APP_URL/);
  });

  it('production refuses DEV_LOGIN_ENABLED', () => {
    expect(() => loadEnv({ ...minimal, NODE_ENV: 'production', DEV_LOGIN_ENABLED: 'true' })).toThrow(/DEV_LOGIN_ENABLED/);
  });

  it('production refuses LITELLM_MODE=mock', () => {
    expect(() => loadEnv({ ...minimal, NODE_ENV: 'production', LITELLM_MODE: 'mock' })).toThrow(/mock/);
  });

  it('production with http mode and no dev login is accepted', () => {
    const e = loadEnv({ ...minimal, NODE_ENV: 'production', LITELLM_MODE: 'http' });
    expect(e.NODE_ENV).toBe('production');
  });

  it('non-production accepts mock + dev login', () => {
    const e = loadEnv({ ...minimal, NODE_ENV: 'test', LITELLM_MODE: 'mock', DEV_LOGIN_ENABLED: 'true' });
    expect(e.LITELLM_MODE).toBe('mock');
    expect(e.DEV_LOGIN_ENABLED).toBe(true);
  });
});
