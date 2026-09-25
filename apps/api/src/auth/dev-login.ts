import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { BetterAuthPlugin } from 'better-auth';
import { z } from 'zod';
import { eq, user } from '@api-selfservice/db';
import type { Deps } from '../context.js';

/**
 * Development-only login without Keycloak (DEV_LOGIN_ENABLED=true; refused in production by loadEnv()).
 * POST /api/auth/dev-login { email, name?, admin?, affiliation? } -> regular Better Auth session cookie.
 */
export function devLoginPlugin(deps: Deps): BetterAuthPlugin {
  return {
    id: 'api-selfservice-dev-login',
    endpoints: {
      devLogin: createAuthEndpoint(
        '/dev-login',
        {
          method: 'POST',
          body: z.object({
            email: z.string().email(),
            name: z.string().optional(),
            admin: z.boolean().optional(),
            affiliation: z.array(z.string()).optional(),
          }),
        },
        async (ctx) => {
          if (!deps.env.DEV_LOGIN_ENABLED || deps.env.NODE_ENV === 'production') {
            return ctx.json({ code: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
          }
          const b = ctx.body;
          let u = await deps.db.query.user.findFirst({ where: eq(user.email, b.email) });
          if (!u) {
            const created = await ctx.context.internalAdapter.createUser({ email: b.email, name: b.name ?? b.email.split('@')[0]!, emailVerified: true }, ctx);
            u = (await deps.db.query.user.findFirst({ where: eq(user.id, created.id) }))!;
          }
          if (b.admin !== undefined) {
            await deps.db.update(user).set({ role: b.admin ? 'admin' : 'user', roleFromIdp: !!b.admin }).where(eq(user.id, u.id));
          }
          if (b.affiliation) await deps.db.update(user).set({ affiliation: b.affiliation, affiliationValid: true }).where(eq(user.id, u.id));
          const session = await ctx.context.internalAdapter.createSession(u.id);
          const fresh = (await ctx.context.internalAdapter.findUserById(u.id))!;
          await setSessionCookie(ctx, { session, user: fresh });
          return ctx.json({ ok: true, userId: u.id });
        },
      ),
    },
  };
}
