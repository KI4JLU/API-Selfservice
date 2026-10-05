import { createRoute, z } from '@hono/zod-openapi';
import {
  CostCenterSchema,
  CostCenterOrLookupSchema,
  CostCenterListQuery,
  CreateCostCenterRequestSchema,
  CostCenterRequestSchema,
  UpdateCostCenterSchema,
  AdminCreateCostCenterSchema,
  RejectSchema,
  CostCenterMemberSchema,
  AddCostCenterMemberSchema,
  UpdateCostCenterMemberSchema,
  MemberCandidateSchema,
  MemberCandidatesQuery,
  CostCenterJoinRequestSchema,
  CreateJoinRequestSchema,
  JoinRequestParam,
  ResolveMemberEmailsSchema,
  ResolvedMemberEmailsSchema,
  BulkAddCostCenterMembersSchema,
  BulkAddCostCenterMembersResultSchema,
  paginated,
} from '@api-selfservice/shared';
import { createRouter, body, json, errors, IdParam, okBody } from './_util.js';
import {
  adminCreateCostCenter,
  approveRequest,
  archiveCostCenter,
  costCenterViewFor,
  getCostCenter,
  listCostCenters,
  listManagedCostCenters,
  listRequests,
  rejectRequest,
  requestCostCenter,
  updateCostCenter,
} from '../services/cost-centers.js';
import { addMember, addMembers, listMembers, removeMember, resolveMemberEmails, searchMemberCandidates, updateMember } from '../services/cost-center-members.js';
import { approveJoinRequest, createJoinRequest, listJoinRequests, listMyJoinRequests, listPendingJoinRequests, rejectJoinRequest } from '../services/cost-center-join-requests.js';
import { requireAdmin, requireCostCenterAdmin } from '../middleware/roles.js';
import { requireCostCenterScope } from '../middleware/scope.js';
import { forbidden } from '../errors.js';

const r = createRouter();

r.openapi(
  createRoute({
    method: 'get',
    path: '/cost-centers',
    tags: ['cost-centers'],
    request: { query: CostCenterListQuery },
    responses: { 200: json(paginated(CostCenterOrLookupSchema), 'Lookup; budget, spend and owner only for admins and managers of the cost center'), ...errors },
  }),
  async (c) => c.json(await listCostCenters(c.get('deps'), c.get('user'), c.req.valid('query')), 200),
);

r.openapi(
  createRoute({
    method: 'post',
    path: '/cost-centers',
    tags: ['cost-centers'],
    request: { body: body(CreateCostCenterRequestSchema) },
    responses: { 201: json(CostCenterRequestSchema, 'Request created'), ...errors },
  }),
  async (c) => c.json(await requestCostCenter(c.get('deps'), c.get('user'), c.req.valid('json')), 201),
);

r.use('/cost-centers/managed', requireCostCenterAdmin);
r.openapi(
  createRoute({
    method: 'get',
    path: '/cost-centers/managed',
    tags: ['cost-centers'],
    responses: { 200: json(paginated(CostCenterSchema), 'Cost centers the current user is cost center admin of'), ...errors },
  }),
  async (c) => c.json(await listManagedCostCenters(c.get('deps'), c.get('user')), 200),
);

r.openapi(
  createRoute({
    method: 'get',
    path: '/cost-centers/{id}',
    tags: ['cost-centers'],
    request: { params: IdParam },
    responses: { 200: json(CostCenterOrLookupSchema, 'Cost center; budget, spend and owner only for admins and managers of it'), ...errors },
  }),
  async (c) => {
    const u = c.get('user');
    const cc = await getCostCenter(c.get('deps'), c.req.valid('param').id);
    if (u.role !== 'admin' && cc.status !== 'approved' && !u.managedCostCenterIds.includes(cc.id)) throw forbidden();
    return c.json(await costCenterViewFor(c.get('deps'), u, cc), 200);
  },
);

r.use('/cost-centers/:id', requireCostCenterAdmin, requireCostCenterScope('id'));
r.openapi(
  createRoute({
    method: 'patch',
    path: '/cost-centers/{id}',
    tags: ['cost-centers'],
    request: { params: IdParam, body: body(UpdateCostCenterSchema) },
    responses: { 200: json(CostCenterSchema, 'Updated'), ...errors },
  }),
  async (c) => c.json(await updateCostCenter(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json')), 200),
);

// ---------- Members (F-KST-10 to F-KST-13): admins for every cost center, cost center admins for their own ----------

const MemberParam = z.object({ id: z.string().min(1), userId: z.string().min(1) });

r.use('/cost-centers/:id/members', requireCostCenterAdmin, requireCostCenterScope('id'));
r.use('/cost-centers/:id/members/*', requireCostCenterAdmin, requireCostCenterScope('id'));
r.use('/cost-centers/:id/member-candidates', requireCostCenterAdmin, requireCostCenterScope('id'));
r.use('/cost-centers/:id/member-candidates/*', requireCostCenterAdmin, requireCostCenterScope('id'));
r.openapi(
  createRoute({
    method: 'get',
    path: '/cost-centers/{id}/members',
    tags: ['cost-centers'],
    request: { params: IdParam },
    responses: { 200: json(z.array(CostCenterMemberSchema), 'Members, admins first'), ...errors },
  }),
  async (c) => c.json(await listMembers(c.get('deps'), c.req.valid('param').id), 200),
);
r.openapi(
  createRoute({
    method: 'get',
    path: '/cost-centers/{id}/member-candidates',
    tags: ['cost-centers'],
    description: 'LiteLLM users matching an e-mail substring or user id (max. 20), including people who never signed in.',
    request: { params: IdParam, query: MemberCandidatesQuery },
    responses: { 200: json(z.array(MemberCandidateSchema), 'Candidates'), ...errors },
  }),
  async (c) => c.json(await searchMemberCandidates(c.get('deps'), c.req.valid('param').id, c.req.valid('query').q), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/cost-centers/{id}/members',
    tags: ['cost-centers'],
    description: 'Adds a user known to LiteLLM to the cost center and its LiteLLM team, and notifies them by e-mail.',
    request: { params: IdParam, body: body(AddCostCenterMemberSchema) },
    responses: { 201: json(CostCenterMemberSchema, 'Member added'), ...errors },
  }),
  async (c) => c.json(await addMember(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json')), 201),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/cost-centers/{id}/member-candidates/resolve',
    tags: ['cost-centers'],
    description: 'Bulk add, step 1: resolves e-mail addresses to LiteLLM users (exact match); lists addresses without a user and invalid entries.',
    request: { params: IdParam, body: body(ResolveMemberEmailsSchema) },
    responses: { 200: json(ResolvedMemberEmailsSchema, 'Resolved addresses'), ...errors },
  }),
  async (c) => c.json(await resolveMemberEmails(c.get('deps'), c.req.valid('param').id, c.req.valid('json').emails), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/cost-centers/{id}/members/bulk',
    tags: ['cost-centers'],
    description: 'Bulk add, step 2: adds each user like POST /cost-centers/{id}/members; failures are reported per user.',
    request: { params: IdParam, body: body(BulkAddCostCenterMembersSchema) },
    responses: { 200: json(BulkAddCostCenterMembersResultSchema, 'Added and failed users'), ...errors },
  }),
  async (c) => c.json(await addMembers(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json')), 200),
);
r.openapi(
  createRoute({
    method: 'patch',
    path: '/cost-centers/{id}/members/{userId}',
    tags: ['cost-centers'],
    request: { params: MemberParam, body: body(UpdateCostCenterMemberSchema) },
    responses: { 200: json(CostCenterMemberSchema, 'Role changed'), ...errors },
  }),
  async (c) => {
    const p = c.req.valid('param');
    return c.json(await updateMember(c.get('deps'), c.get('user'), p.id, p.userId, c.req.valid('json').role), 200);
  },
);
r.openapi(
  createRoute({
    method: 'delete',
    path: '/cost-centers/{id}/members/{userId}',
    tags: ['cost-centers'],
    description: 'Removes the member from the cost center and its LiteLLM team; their keys on this cost center are blocked.',
    request: { params: MemberParam },
    responses: { 200: json(okBody, 'Member removed'), ...errors },
  }),
  async (c) => {
    const p = c.req.valid('param');
    await removeMember(c.get('deps'), c.get('user'), p.id, p.userId);
    return c.json({ ok: true as const }, 200);
  },
);

// ---------- Join requests (F-KST-16): every user asks, admins and the cost center's own admins decide ----------

r.openapi(
  createRoute({ method: 'get', path: '/me/join-requests', tags: ['cost-centers'], responses: { 200: json(z.array(CostCenterJoinRequestSchema), 'Own join requests, newest first'), ...errors } }),
  async (c) => c.json(await listMyJoinRequests(c.get('deps'), c.get('user')), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/me/join-requests',
    tags: ['cost-centers'],
    description: 'Asks to join an approved cost center; its owner and cost center admins are notified by e-mail.',
    request: { body: body(CreateJoinRequestSchema) },
    responses: { 201: json(CostCenterJoinRequestSchema, 'Join request created'), ...errors },
  }),
  async (c) => c.json(await createJoinRequest(c.get('deps'), c.get('user'), c.req.valid('json')), 201),
);

r.use('/cost-center-join-requests', requireCostCenterAdmin);
r.openapi(
  createRoute({
    method: 'get',
    path: '/cost-center-join-requests',
    tags: ['cost-centers'],
    description: 'Open join requests of every cost center the current user decides on (all for admins), newest first.',
    responses: { 200: json(z.array(CostCenterJoinRequestSchema), 'Pending join requests'), ...errors },
  }),
  async (c) => c.json(await listPendingJoinRequests(c.get('deps'), c.get('user')), 200),
);

r.use('/cost-centers/:id/join-requests', requireCostCenterAdmin, requireCostCenterScope('id'));
r.use('/cost-centers/:id/join-requests/*', requireCostCenterAdmin, requireCostCenterScope('id'));
r.openapi(
  createRoute({
    method: 'get',
    path: '/cost-centers/{id}/join-requests',
    tags: ['cost-centers'],
    request: { params: IdParam, query: z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }) },
    responses: { 200: json(z.array(CostCenterJoinRequestSchema), 'Join requests, newest first'), ...errors },
  }),
  async (c) => c.json(await listJoinRequests(c.get('deps'), c.req.valid('param').id, c.req.valid('query').status), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/cost-centers/{id}/join-requests/{requestId}/approve',
    tags: ['cost-centers'],
    description: 'Adds the requester as member (role user), like POST /cost-centers/{id}/members.',
    request: { params: JoinRequestParam },
    responses: { 200: json(CostCenterJoinRequestSchema, 'Approved'), ...errors },
  }),
  async (c) => {
    const p = c.req.valid('param');
    return c.json(await approveJoinRequest(c.get('deps'), c.get('user'), p.id, p.requestId), 200);
  },
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/cost-centers/{id}/join-requests/{requestId}/reject',
    tags: ['cost-centers'],
    request: { params: JoinRequestParam, body: body(RejectSchema) },
    responses: { 200: json(CostCenterJoinRequestSchema, 'Rejected'), ...errors },
  }),
  async (c) => {
    const p = c.req.valid('param');
    return c.json(await rejectJoinRequest(c.get('deps'), c.get('user'), p.id, p.requestId, c.req.valid('json').reason), 200);
  },
);

r.use('/admin/cost-centers/*', requireAdmin);
r.use('/admin/cost-centers', requireAdmin);
r.use('/cost-center-requests', requireAdmin);
r.use('/cost-center-requests/*', requireAdmin);

r.openapi(
  createRoute({
    method: 'post',
    path: '/admin/cost-centers',
    tags: ['cost-centers'],
    request: { body: body(AdminCreateCostCenterSchema) },
    responses: { 201: json(CostCenterSchema, 'Created (approved)'), ...errors },
  }),
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
    request: {
      query: z.object({
        status: z.enum(['pending', 'approved', 'rejected']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }),
    },
    responses: { 200: json(paginated(CostCenterRequestSchema), 'Requests'), ...errors },
  }),
  async (c) => c.json(await listRequests(c.get('deps'), c.req.valid('query')), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/cost-center-requests/{id}/approve',
    tags: ['cost-centers'],
    request: { params: IdParam },
    responses: { 200: json(CostCenterRequestSchema, 'Approved'), ...errors },
  }),
  async (c) => c.json(await approveRequest(c.get('deps'), c.get('user'), c.req.valid('param').id), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/cost-center-requests/{id}/reject',
    tags: ['cost-centers'],
    request: { params: IdParam, body: body(RejectSchema) },
    responses: { 200: json(CostCenterRequestSchema, 'Rejected'), ...errors },
  }),
  async (c) => c.json(await rejectRequest(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json').reason), 200),
);

export const costCenterRoutes = r;
