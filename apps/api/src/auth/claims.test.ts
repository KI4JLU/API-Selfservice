import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env.js';
import { decodeJwtPayload, extractClaims, isAdminByGroup, isAffiliationValid } from './claims.js';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://x',
  AUTH_SECRET: 'x'.repeat(32),
};

const env = (extra: Record<string, string> = {}) => loadEnv({ ...baseEnv, KEYCLOAK_AFFILIATION_VALID: 'member,staff', ...extra });

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: unknown) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.signature`;

describe('decodeJwtPayload', () => {
  it('decodes the base64url payload without verification', () => {
    expect(decodeJwtPayload(jwt({ sub: 'abc', groups: ['/LiteLLMAdmin'] }))).toEqual({ sub: 'abc', groups: ['/LiteLLMAdmin'] });
  });
  it('handles url-safe characters (- and _)', () => {
    const payload = { sub: 'a?b>c~~~', name: 'ÄÖÜ ß' };
    expect(decodeJwtPayload(jwt(payload))).toEqual(payload);
  });
  it('returns null for malformed tokens', () => {
    expect(decodeJwtPayload('nodots')).toBeNull();
    expect(decodeJwtPayload('a.!!!notbase64json!!!.c')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
  });
});

describe('extractClaims', () => {
  it('strips leading slashes from group arrays', () => {
    const c = extractClaims({ sub: 's', groups: ['/LiteLLMAdmin', '/Other', 'Plain'], eduPersonAffiliation: ['member'] }, env());
    expect(c).toEqual({ sub: 's', groups: ['LiteLLMAdmin', 'Other', 'Plain'], affiliation: ['member'] });
  });
  it('accepts comma/space separated strings', () => {
    const c = extractClaims({ groups: '/A, /B C', eduPersonAffiliation: 'member staff' }, env());
    expect(c.groups).toEqual(['A', 'B', 'C']);
    expect(c.affiliation).toEqual(['member', 'staff']);
    expect(c.sub).toBeNull();
  });
  it('uses configurable claim names', () => {
    const c = extractClaims({ roles: ['/X'], aff: 'staff' }, env({ KEYCLOAK_GROUPS_CLAIM: 'roles', KEYCLOAK_AFFILIATION_CLAIM: 'aff' }));
    expect(c.groups).toEqual(['X']);
    expect(c.affiliation).toEqual(['staff']);
  });
  it('returns empty arrays for missing or non-string claims', () => {
    const c = extractClaims({ sub: 42, groups: 7 }, env());
    expect(c).toEqual({ sub: null, groups: [], affiliation: [] });
  });
  it('stringifies non-string array members', () => {
    expect(extractClaims({ groups: [1, true] }, env()).groups).toEqual(['1', 'true']);
  });
});

describe('isAdminByGroup', () => {
  it('matches the configured admin group (default LiteLLMAdmin)', () => {
    const e = env();
    expect(isAdminByGroup({ sub: null, groups: ['LiteLLMAdmin'], affiliation: [] }, e)).toBe(true);
    expect(isAdminByGroup({ sub: null, groups: ['litellmadmin'], affiliation: [] }, e)).toBe(false);
    expect(isAdminByGroup({ sub: null, groups: [], affiliation: [] }, e)).toBe(false);
  });
  it('honours KEYCLOAK_ADMIN_GROUP', () => {
    const e = env({ KEYCLOAK_ADMIN_GROUP: 'Ops' });
    expect(isAdminByGroup({ sub: null, groups: ['Ops'], affiliation: [] }, e)).toBe(true);
    expect(isAdminByGroup({ sub: null, groups: ['LiteLLMAdmin'], affiliation: [] }, e)).toBe(false);
  });
});

describe('isAffiliationValid', () => {
  it('requires one of the configured values', () => {
    const e = env();
    expect(isAffiliationValid({ sub: null, groups: [], affiliation: ['student', 'member'] }, e)).toBe(true);
    expect(isAffiliationValid({ sub: null, groups: [], affiliation: ['staff'] }, e)).toBe(true);
    expect(isAffiliationValid({ sub: null, groups: [], affiliation: ['student'] }, e)).toBe(false);
    expect(isAffiliationValid({ sub: null, groups: [], affiliation: [] }, e)).toBe(false);
  });
  it('an empty KEYCLOAK_AFFILIATION_VALID disables the check', () => {
    const e = loadEnv({ ...baseEnv, KEYCLOAK_AFFILIATION_VALID: '' });
    expect(e.KEYCLOAK_AFFILIATION_VALID).toEqual([]);
    expect(isAffiliationValid({ sub: null, groups: [], affiliation: [] }, e)).toBe(true);
    expect(isAffiliationValid({ sub: null, groups: [], affiliation: ['alumni'] }, e)).toBe(true);
  });
});
