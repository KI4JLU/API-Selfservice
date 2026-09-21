import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context.js';
import { forbidden } from '../errors.js';

/** Step 4: cost-center admins may only touch cost centers assigned to them. Admins pass. */
export function requireCostCenterScope(param = 'id') {
  return createMiddleware<AppEnv>(async (c, next) => {
    const u = c.get('user');
    if (u.role !== 'admin') {
      const id = c.req.param(param);
      if (!id || !u.managedCostCenterIds.includes(id)) throw forbidden('Cost center not in scope');
    }
    await next();
  });
}
