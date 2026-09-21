import { createMiddleware } from 'hono/factory';
import type { EffectiveRole } from '@litelite/shared';
import type { AppEnv } from '../context.js';
import { forbidden } from '../errors.js';

/** Step 3: route declares allowed roles. `cost_center_admin` implies admins too. */
export function requireRole(...roles: EffectiveRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const u = c.get('user');
    const ok = u.role === 'admin' ? true : roles.includes(u.effectiveRole) || roles.includes('user');
    if (!ok || (roles.length === 1 && roles[0] === 'admin' && u.role !== 'admin')) throw forbidden();
    await next();
  });
}

export const requireAdmin = requireRole('admin');
export const requireCostCenterAdmin = requireRole('cost_center_admin', 'admin');
