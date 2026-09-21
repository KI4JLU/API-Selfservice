import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { LiteLLMHttpError } from '../litellm/types.js';
import { auditError } from '../services/audit.js';

export const onError: ErrorHandler<AppEnv> = async (err, c) => {
  const deps = c.get('deps');
  /** Unexpected failures go to the admin event log; `user` is unset when the error happened before the session step. */
  const record = (action: string) =>
    deps
      ? auditError(deps, {
          action,
          entity: 'request',
          entityId: c.get('requestId'),
          err,
          actorId: c.get('user')?.id ?? null,
          payload: { method: c.req.method, path: c.req.path },
        })
      : Promise.resolve();
  if (err instanceof ApiError) {
    return c.json(err.toBody(), err.status as 400);
  }
  if (err instanceof ZodError) {
    return c.json({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: err.issues }, 400);
  }
  if (err instanceof LiteLLMHttpError) {
    await record('request.litellm_error');
    return c.json({ code: 'LITELLM_ERROR', message: err.message }, 502);
  }
  await record('request.internal_error');
  return c.json({ code: 'INTERNAL', message: 'Internal error' }, 500);
};
