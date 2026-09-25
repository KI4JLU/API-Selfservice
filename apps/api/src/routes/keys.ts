import { createRoute, z } from '@hono/zod-openapi';
import { ApiKeySchema, AdminApiKeySchema, AdminApiKeysQuery, CreateApiKeySchema, CreatedApiKeySchema, UpdateApiKeySchema, paginated } from '@api-selfservice/shared';
import { createRouter, body, json, errors, IdParam, okBody } from './_util.js';
import { adminBlockKey, adminListKeys, createKey, deleteKey, extendKey, listMyKeys, updateKey } from '../services/keys.js';
import { requireAdmin } from '../middleware/roles.js';

const r = createRouter();

r.openapi(createRoute({ method: 'get', path: '/api-keys', tags: ['api-keys'], responses: { 200: json(paginated(ApiKeySchema), 'Own keys'), ...errors } }), async (c) =>
  c.json(await listMyKeys(c.get('deps'), c.get('user')), 200),
);
r.openapi(
  createRoute({ method: 'post', path: '/api-keys', tags: ['api-keys'], request: { body: body(CreateApiKeySchema) }, responses: { 201: json(CreatedApiKeySchema, 'Created; secret shown once'), ...errors } }),
  async (c) => c.json(await createKey(c.get('deps'), c.get('user'), c.req.valid('json')), 201),
);
r.openapi(
  createRoute({ method: 'patch', path: '/api-keys/{id}', tags: ['api-keys'], request: { params: IdParam, body: body(UpdateApiKeySchema) }, responses: { 200: json(ApiKeySchema, 'Updated'), ...errors } }),
  async (c) => c.json(await updateKey(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json')), 200),
);
r.openapi(
  createRoute({ method: 'delete', path: '/api-keys/{id}', tags: ['api-keys'], request: { params: IdParam }, responses: { 200: json(okBody, 'Deleted'), ...errors } }),
  async (c) => {
    await deleteKey(c.get('deps'), c.get('user'), c.req.valid('param').id);
    return c.json({ ok: true as const }, 200);
  },
);
r.openapi(
  createRoute({ method: 'post', path: '/api-keys/{id}/extend', tags: ['api-keys'], request: { params: IdParam }, responses: { 200: json(ApiKeySchema, 'Extended'), ...errors } }),
  async (c) => c.json(await extendKey(c.get('deps'), c.get('user'), c.req.valid('param').id), 200),
);

r.use('/admin/api-keys', requireAdmin);
r.use('/admin/api-keys/*', requireAdmin);
r.openapi(
  createRoute({ method: 'get', path: '/admin/api-keys', tags: ['api-keys'], request: { query: AdminApiKeysQuery }, responses: { 200: json(paginated(AdminApiKeySchema), 'All keys'), ...errors } }),
  async (c) => c.json(await adminListKeys(c.get('deps'), c.req.valid('query')), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/admin/api-keys/{id}/block',
    tags: ['api-keys'],
    request: { params: IdParam, body: { content: { 'application/json': { schema: z.object({ blocked: z.boolean().default(true) }) } } } },
    responses: { 200: json(AdminApiKeySchema, 'Blocked / unblocked'), ...errors },
  }),
  async (c) => c.json(await adminBlockKey(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json').blocked ?? true), 200),
);

export const keyRoutes = r;
