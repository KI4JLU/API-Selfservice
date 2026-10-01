import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Origin of the Referer header; null when missing or malformed. */
function refererOrigin(referer: string | undefined) {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** Step 2: mutating requests must carry an Origin (or Referer) header of a trusted origin. */
export function csrfMiddleware(trusted: string[]) {
  const allowed = new Set(trusted.map((t) => new URL(t).origin));
  return createMiddleware<AppEnv>(async (c, next) => {
    if (MUTATING.has(c.req.method)) {
      const origin = c.req.header('origin') ?? refererOrigin(c.req.header('referer'));
      if (!origin || !allowed.has(origin)) throw new ApiError('CSRF_ORIGIN_MISMATCH', 'Origin not allowed');
    }
    await next();
  });
}
