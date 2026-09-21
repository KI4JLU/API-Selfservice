import { eq, session, user } from '@litelite/db';
import type { CurrentUser, Deps } from '../context.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { audit } from './audit.js';

/**
 * Admin impersonation for debugging (IMPERSONATION_ENABLED). The admin keeps their own session;
 * the session row remembers the target and the session middleware swaps the current user.
 */
export async function startImpersonation(deps: Deps, actor: CurrentUser, sessionId: string, targetId: string) {
  if (!deps.env.IMPERSONATION_ENABLED) throw forbidden('Impersonation is disabled (IMPERSONATION_ENABLED)');
  if (actor.role !== 'admin') throw forbidden();
  if (targetId === actor.id) throw new ApiError('VALIDATION_ERROR', 'Cannot impersonate yourself');
  const target = await deps.db.query.user.findFirst({ where: eq(user.id, targetId) });
  if (!target) throw notFound('User');
  if (target.deletedAt) throw new ApiError('ACCOUNT_DEACTIVATED', 'Cannot impersonate a deactivated user');
  if (!target.affiliationValid) throw new ApiError('ACCOUNT_INVALID_AFFILIATION', 'Cannot impersonate a user with invalid affiliation');
  await deps.db.update(session).set({ impersonatedUserId: target.id, updatedAt: deps.now() }).where(eq(session.id, sessionId));
  await audit(deps, { actorId: actor.id, action: 'user.impersonate', entity: 'user', entityId: target.id, payload: { sessionId } });
  deps.log.info({ actorId: actor.id, targetId: target.id, sessionId }, 'impersonation started');
}

/** Ends impersonation on the given session. `actor` is the real signed-in admin. */
export async function stopImpersonation(deps: Deps, actor: CurrentUser, sessionId: string, targetId: string) {
  await clearImpersonation(deps, sessionId);
  await audit(deps, { actorId: actor.id, action: 'user.impersonate_stop', entity: 'user', entityId: targetId, payload: { sessionId } });
  deps.log.info({ actorId: actor.id, targetId, sessionId }, 'impersonation stopped');
}

export async function clearImpersonation(deps: Deps, sessionId: string) {
  await deps.db.update(session).set({ impersonatedUserId: null, updatedAt: deps.now() }).where(eq(session.id, sessionId));
}
