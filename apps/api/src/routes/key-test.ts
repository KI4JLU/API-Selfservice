import { createRoute } from '@hono/zod-openapi';
import { KeyTestModelsRequestSchema, KeyTestModelsSchema, KeyTestRequestSchema, KeyTestResultSchema } from '@api-selfservice/shared';
import { createRouter, body, json, errors } from './_util.js';
import { listKeyTestModels, runKeyTest } from '../services/key-test.js';

const r = createRouter();

// F-KEY-9: every signed-in user may test a key; the key itself is the credential towards LiteLLM.
r.openapi(
  createRoute({
    method: 'post',
    path: '/key-test/models',
    tags: ['key-test'],
    request: { body: body(KeyTestModelsRequestSchema) },
    responses: { 200: json(KeyTestModelsSchema, 'Models the key may call'), ...errors },
  }),
  async (c) => c.json(await listKeyTestModels(c.get('deps'), c.req.valid('json').key), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/key-test',
    tags: ['key-test'],
    request: { body: body(KeyTestRequestSchema) },
    responses: { 200: json(KeyTestResultSchema, 'Answer to the test prompt'), ...errors },
  }),
  async (c) => c.json(await runKeyTest(c.get('deps'), c.req.valid('json')), 200),
);

export const keyTestRoutes = r;
