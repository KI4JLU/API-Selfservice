import { createRoute, z } from '@hono/zod-openapi';
import {
  CostCenterSchema,
  CostCenterListQuery,
  CreateCostCenterRequestSchema,
  CostCenterRequestSchema,
  UpdateCostCenterSchema,
  AdminCreateCostCenterSchema,
  RejectSchema,
  paginated,
} from '@api-selfservice/shared';
import { createRouter, body, json, errors, IdParam } from './_util.js';
import {
  adminCreateCostCenter,
  approveRequest,
  archiveCostCenter,
  costCenterView,
  getCostCenter,
  listCostCenters,
  listManagedCostCenters,
  listRequests,
  rejectRequest,
  requestCostCenter,
  updateCostCenter,
} from '../services/cost-centers.js';
import { requireAdmin, requireCostCenterAdmin } from '../middleware/roles.js';
import { requireCostCenterScope } from '../middleware/scope.js';
import { forbidden } from '../errors.js';

const r = createRouter();

r.openapi(
  createRoute({ method: 'get', path: '/cost-centers', tags: ['cost-centers'], request: { query: CostCenterListQuery }, responses: { 200: json(paginated(CostCenterSchema), 'Lookup'), ...errors } }),
  async (c) => c.json(await listCostCenters(c.get('deps'), c.get('user'), c.req.valid('query')), 200),
);

r.openapi(
  createRoute({ method: 'post', path: '/cost-centers', tags: ['cost-centers'], request: { body: body(CreateCostCenterRequestSchema) }, responses: { 201: json(CostCenterRequestSchema, 'Request created'), ...errors } }),
  async (c) => c.json(await requestCostCenter(c.get('deps'), c.get('user'), c.req.valid('json')), 201),
);

r.use('/cost-centers/managed', requireCostCenterAdmin);
r.openapi(
  createRoute({ method: 'get', path: '/cost-centers/managed', tags: ['cost-centers'], responses: { 200: json(paginated(CostCenterSchema), 'Cost centers managed by the current user (all for admins)'), ...errors } }),
  async (c) => c.json(await listManagedCostCenters(c.get('deps'), c.get('user')), 200),
);

r.openapi(
  createRoute({ method: 'get', path: '/cost-centers/{id}', tags: ['cost-centers'], request: { params: IdParam }, responses: { 200: json(CostCenterSchema, 'Cost center'), ...errors } }),
  async (c) => {
    const u = c.get('user');
    const cc = await getCostCenter(c.get('deps'), c.req.valid('param').id);
    if (u.role !== 'admin' && cc.status !== 'approved' && !u.managedCostCenterIds.includes(cc.id)) throw forbidden();
    return c.json(await costCenterView(c.get('deps'), cc), 200);
  },
);

r.use('/cost-centers/:id', requireCostCenterAdmin, requireCostCenterScope('id'));
r.openapi(
  createRoute({ method: 'patch', path: '/cost-centers/{id}', tags: ['cost-centers'], request: { params: IdParam, body: body(UpdateCostCenterSchema) }, responses: { 200: json(CostCenterSchema, 'Updated'), ...errors } }),
  async (c) => c.json(await updateCostCenter(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json')), 200),
);

r.use('/admin/cost-centers/*', requireAdmin);
r.use('/admin/cost-centers', requireAdmin);
r.use('/cost-center-requests', requireAdmin);
r.use('/cost-center-requests/*', requireAdmin);

r.openapi(
  createRoute({ method: 'post', path: '/admin/cost-centers', tags: ['cost-centers'], request: { body: body(AdminCreateCostCenterSchema) }, responses: { 201: json(CostCenterSchema, 'Created (approved)'), ...errors } }),
  async (c) => c.json(await adminCreateCostCenter(c.get('deps'), c.get('user'), c.req.valid('json')), 201),
);
r.openapi(
  createRoute({ method: 'post', path: '/admin/cost-centers/{id}/archive', tags: ['cost-centers'], request: { params: IdParam }, responses: { 200: json(CostCenterSchema, 'Archived'), ...errors } }),
  async (c) => c.json(await archiveCostCenter(c.get('deps'), c.get('user'), c.req.valid('param').id), 200),
);
r.openapi(
  createRoute({
    method: 'get',
    path: '/cost-center-requests',
    tags: ['cost-centers'],
    request: { query: z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }) },
    responses: { 200: json(paginated(CostCenterRequestSchema), 'Requests'), ...errors },
  }),
  async (c) => c.json(await listRequests(c.get('deps'), c.req.valid('query')), 200),
);
r.openapi(
  createRoute({ method: 'post', path: '/cost-center-requests/{id}/approve', tags: ['cost-centers'], request: { params: IdParam }, responses: { 200: json(CostCenterRequestSchema, 'Approved'), ...errors } }),
  async (c) => c.json(await approveRequest(c.get('deps'), c.get('user'), c.req.valid('param').id), 200),
);
r.openapi(
  createRoute({ method: 'post', path: '/cost-center-requests/{id}/reject', tags: ['cost-centers'], request: { params: IdParam, body: body(RejectSchema) }, responses: { 200: json(CostCenterRequestSchema, 'Rejected'), ...errors } }),
  async (c) => c.json(await rejectRequest(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json').reason), 200),
);

export const costCenterRoutes = r;
