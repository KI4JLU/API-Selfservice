import { createRoute, z } from '@hono/zod-openapi';
import { ProviderSchema, ProviderSyncResult, UpdateProviderSchema } from '@litelite/shared';
import { createRouter, body, json, errors, IdParam } from './_util.js';
import { adminListProviders, listProvidersForUser, syncProviders, updateProvider } from '../services/providers.js';
import { requireAdmin } from '../middleware/roles.js';

const r = createRouter();

r.openapi(
  createRoute({
    method: 'get',
    path: '/providers',
    tags: ['providers'],
    request: { query: z.object({ costCenterId: z.string().optional() }) },
    responses: { 200: json(z.array(ProviderSchema), 'Models available for the given (or own) cost center'), ...errors },
  }),
  async (c) => c.json(await listProvidersForUser(c.get('deps'), c.get('user'), c.req.valid('query').costCenterId), 200),
);

r.use('/admin/providers', requireAdmin);
r.use('/admin/providers/*', requireAdmin);
r.openapi(createRoute({ method: 'get', path: '/admin/providers', tags: ['providers'], responses: { 200: json(z.array(ProviderSchema), 'All providers'), ...errors } }), async (c) =>
  c.json(await adminListProviders(c.get('deps')), 200),
);
r.openapi(
  createRoute({ method: 'patch', path: '/admin/providers/{id}', tags: ['providers'], request: { params: IdParam, body: body(UpdateProviderSchema) }, responses: { 200: json(ProviderSchema, 'Updated'), ...errors } }),
  async (c) => c.json(await updateProvider(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json')), 200),
);
r.openapi(createRoute({ method: 'post', path: '/admin/providers/sync', tags: ['providers'], responses: { 200: json(ProviderSyncResult, 'Synced from LiteLLM'), ...errors } }), async (c) =>
  c.json(await syncProviders(c.get('deps'), c.get('user').id), 200),
);

export const providerRoutes = r;
