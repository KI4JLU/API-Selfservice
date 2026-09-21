import { OpenAPIHono, z } from '@hono/zod-openapi';
import { ErrorSchema } from '@litelite/shared';
import type { AppEnv } from '../context.js';

export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: result.error.issues }, 400);
      }
    },
  });
}

export const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

export const body = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});

export const errors = {
  400: json(ErrorSchema, 'Validation error'),
  401: json(ErrorSchema, 'Not signed in'),
  403: json(ErrorSchema, 'Forbidden'),
  404: json(ErrorSchema, 'Not found'),
  409: json(ErrorSchema, 'Conflict'),
};

export const IdParam = z.object({ id: z.string().min(1) });
export const okBody = z.object({ ok: z.literal(true) });
