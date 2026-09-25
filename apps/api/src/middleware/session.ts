import { createMiddleware } from 'hono/factory';
import { eq, session } from '@api-selfservice/db';
import type { AppEnv, CurrentUser } from '../context.js';
import { ApiError } from '../errors.js';
import type { Auth } from '../auth/auth.js';
import { loadCurrentUser } from '../services/users.js';
import { clearImpersonation } from '../services/impersonation.js';

/**
 * Step 1 of the security chain: resolve the Better Auth session and load the user.
 * With IMPERSONATION_ENABLED, an admin session that carries `impersonatedUserId` acts as that user;
 * the admin stays available as `impersonator`.
 */
export function sessionMiddleware(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const s = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!s) throw new ApiError('UNAUTHORIZED', 'Not signed in');
    const deps = c.get('deps');
    const actor = await loadCurrentUser(deps, s.user.id);
    if (!actor) throw new ApiError('UNAUTHORIZED', 'User not found');
    c.set('sessionId', s.session.id);

    let current: CurrentUser = actor;
    if (deps.env.IMPERSONATION_ENABLED && actor.role === 'admin') {
      const row = await deps.db.query.session.findFirst({ where: eq(session.id, s.session.id), columns: { impersonatedUserId: true } });
      if (row?.impersonatedUserId && row.impersonatedUserId !== actor.id) {
        const target = await loadImpersonated(deps, row.impersonatedUserId);
        if (target) {
          current = target;
          c.set('impersonator', actor);
        } else {
          // Target vanished or was deactivated: never lock the admin out, just drop the impersonation.
          await clearImpersonation(deps, s.session.id);
        }
      }
    }
    c.set('user', current);
    await next();
  });
}

async function loadImpersonated(deps: AppEnv['Variables']['deps'], userId: string): Promise<CurrentUser | null> {
  try {
    return await loadCurrentUser(deps, userId);
  } catch (e) {
    if (e instanceof ApiError) return null;
    throw e;
  }
}
