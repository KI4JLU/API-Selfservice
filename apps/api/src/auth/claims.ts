/** Better Auth provider id of the Keycloak OIDC client; `account.account_id` holds the Keycloak subject. */
export const KEYCLOAK_PROVIDER_ID = 'keycloak';

import type { Env } from '../env.js';

export interface IdpClaims {
  sub: string | null;
  groups: string[];
  affiliation: string[];
}

/** Decodes the JWT payload without verification (token came from the token endpoint over TLS). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.split(/[,\s]+/).filter(Boolean);
  return [];
}

export function extractClaims(payload: Record<string, unknown>, env: Env): IdpClaims {
  return {
    sub: typeof payload.sub === 'string' ? payload.sub : null,
    groups: asStringArray(payload[env.KEYCLOAK_GROUPS_CLAIM]).map((g) => g.replace(/^\//, '')),
    affiliation: asStringArray(payload[env.KEYCLOAK_AFFILIATION_CLAIM]),
  };
}

export function isAdminByGroup(claims: IdpClaims, env: Env): boolean {
  return claims.groups.includes(env.KEYCLOAK_ADMIN_GROUP);
}

/** Empty KEYCLOAK_AFFILIATION_VALID disables the check. */
export function isAffiliationValid(claims: IdpClaims, env: Env): boolean {
  if (env.KEYCLOAK_AFFILIATION_VALID.length === 0) return true;
  return claims.affiliation.some((a) => env.KEYCLOAK_AFFILIATION_VALID.includes(a));
}
