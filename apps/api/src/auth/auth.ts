import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth, keycloak } from 'better-auth/plugins/generic-oauth';
import { account, session, user, verification, eq } from '@litelite/db';
import type { Deps } from '../context.js';
import { decodeJwtPayload, extractClaims, isAdminByGroup, isAffiliationValid } from './claims.js';
import { findLitellmUserIdByEmail, onUserCreated, syncIdpClaims } from '../services/users.js';
import { devLoginPlugin } from './dev-login.js';

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(deps: Deps) {
  const { env, db, log } = deps;
  const providers = [];
  if (env.KEYCLOAK_ISSUER && env.KEYCLOAK_CLIENT_ID) {
    providers.push(
      keycloak({
        issuer: env.KEYCLOAK_ISSUER,
        clientId: env.KEYCLOAK_CLIENT_ID,
        clientSecret: env.KEYCLOAK_CLIENT_SECRET,
        scopes: ['openid', 'profile', 'email'],
        pkce: true,
        postLogoutRedirectURI: env.APP_URL,
      }),
    );
  } else {
    log.warn('Keycloak not configured (KEYCLOAK_ISSUER / KEYCLOAK_CLIENT_ID missing)');
  }

  return betterAuth({
    baseURL: env.API_URL,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.APP_URL, env.API_URL],
    database: drizzleAdapter(db, { provider: 'pg', schema: { user, session, account, verification } }),
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 15,
      cookieCache: { enabled: false },
    },
    account: { updateAccountOnSignIn: true },
    advanced: {
      cookiePrefix: 'litelite',
      useSecureCookies: env.NODE_ENV === 'production',
      // A function instead of 'uuid': Better Auth then accepts an id supplied by the create.before hook,
      // which is how an existing LiteLLM user is adopted (E-7).
      database: { generateId: () => randomUUID() },
    },
    user: {
      additionalFields: {
        role: { type: 'string', defaultValue: 'user', input: false },
        locale: { type: 'string', defaultValue: 'de', input: false },
      },
    },
    plugins: [...(providers.length ? [genericOAuth({ config: providers })] : []), ...(env.DEV_LOGIN_ENABLED ? [devLoginPlugin(deps)] : [])],
    databaseHooks: {
      user: {
        create: {
          before: async (u) => {
            const id = await findLitellmUserIdByEmail(deps, u.email);
            return id ? { data: { ...u, id } } : undefined;
          },
          after: async (u) => {
            await onUserCreated(deps, { id: u.id, email: u.email, name: u.name });
          },
        },
      },
      session: {
        create: {
          after: async (s) => {
            // Runs on every login: sync group/affiliation claims from the ID token.
            const acc = await db.query.account.findFirst({ where: eq(account.userId, s.userId) });
            const payload = acc?.idToken ? decodeJwtPayload(acc.idToken) : null;
            if (!payload) {
              await syncIdpClaims(deps, s.userId, null);
              return;
            }
            const claims = extractClaims(payload, env);
            await syncIdpClaims(deps, s.userId, {
              sub: claims.sub,
              affiliation: claims.affiliation,
              isAdmin: isAdminByGroup(claims, env),
              affiliationValid: isAffiliationValid(claims, env),
            });
          },
        },
      },
    },
  });
}
