import type { Env } from '../env.js';

/**
 * Optional Keycloak Admin API client for the Austrittsprozess (F-USR-4).
 * Needs a confidential client with service account and the realm role `view-users`
 * (KEYCLOAK_ADMIN_CLIENT_ID / KEYCLOAK_ADMIN_CLIENT_SECRET). Without it the job falls back
 * to the claims captured at the last login.
 */
export interface KeycloakAdmin {
  /** Returns null when the user no longer exists in Keycloak. */
  getUser(sub: string): Promise<{ enabled: boolean; groups: string[]; affiliation: string[] } | null>;
}

export function createKeycloakAdmin(env: Env, fetchImpl: typeof fetch = fetch): KeycloakAdmin | null {
  if (!env.KEYCLOAK_ISSUER || !env.KEYCLOAK_ADMIN_CLIENT_ID || !env.KEYCLOAK_ADMIN_CLIENT_SECRET) return null;
  const issuer = env.KEYCLOAK_ISSUER.replace(/\/$/, '');
  const adminBase = issuer.replace('/realms/', '/admin/realms/');
  let token: { value: string; exp: number } | null = null;

  async function getToken() {
    if (token && token.exp > Date.now() + 10000) return token.value;
    const res = await fetchImpl(`${issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.KEYCLOAK_ADMIN_CLIENT_ID!,
        client_secret: env.KEYCLOAK_ADMIN_CLIENT_SECRET!,
      }),
    });
    if (!res.ok) throw new Error(`keycloak token ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return token.value;
  }

  async function get<T>(p: string): Promise<T | null> {
    const res = await fetchImpl(`${adminBase}${p}`, { headers: { Authorization: `Bearer ${await getToken()}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`keycloak admin ${p} -> ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async getUser(sub) {
      const u = await get<{ enabled: boolean; attributes?: Record<string, string[]> }>(`/users/${encodeURIComponent(sub)}`);
      if (!u) return null;
      const groups = (await get<Array<{ name: string; path: string }>>(`/users/${encodeURIComponent(sub)}/groups`)) ?? [];
      return {
        enabled: u.enabled,
        groups: groups.map((g) => g.name),
        affiliation: u.attributes?.[env.KEYCLOAK_AFFILIATION_CLAIM] ?? [],
      };
    },
  };
}
