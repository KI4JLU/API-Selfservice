import { createRoute } from '@hono/zod-openapi';
import {
  AdminBudgetRowSchema,
  AdminBudgetsQuery,
  AdminUserSchema,
  AdminUsersQuery,
  AuditEventSchema,
  AuditEventsQuery,
  BudgetSchema,
  JobIngestResultSchema,
  JobKeyExpiryResultSchema,
  LitellmUserSchema,
  LitellmUsersQuery,
  NotificationSchema,
  NotificationsQuery,
  SetBudgetSchema,
  SetCostCenterAdminSchema,
  SetRoleSchema,
  paginated,
} from '@api-selfservice/shared';
import { and, count, desc, eq, notifications } from '@api-selfservice/db';
import { createRouter, body, json, errors, IdParam, okBody } from './_util.js';
import { startImpersonation } from '../services/impersonation.js';
import { deactivateUser, getUserAdmin, listUsers, reactivateUser, searchLitellmUsers, setCostCenterAdmin, setRole } from '../services/users.js';
import { adminBudgets, setUserBudget } from '../services/budgets.js';
import { listEvents } from '../services/audit.js';
import { requireAdmin } from '../middleware/roles.js';
import { runIngestAndBudgets, runKeyExpiry } from '../jobs/index.js';

const r = createRouter();
r.use('/admin/*', requireAdmin);

r.openapi(
  createRoute({ method: 'get', path: '/admin/users', tags: ['users'], request: { query: AdminUsersQuery }, responses: { 200: json(paginated(AdminUserSchema), 'Users'), ...errors } }),
  async (c) => c.json(await listUsers(c.get('deps'), c.req.valid('query')), 200),
);
r.openapi(
  createRoute({
    method: 'get',
    path: '/admin/litellm-users',
    tags: ['users'],
    description: 'Users as LiteLLM knows them (user master), each with the matching API-Selfservice account if one exists.',
    request: { query: LitellmUsersQuery },
    responses: { 200: json(paginated(LitellmUserSchema), 'LiteLLM users'), ...errors },
  }),
  async (c) => c.json(await searchLitellmUsers(c.get('deps'), c.req.valid('query')), 200),
);
r.openapi(createRoute({ method: 'get', path: '/admin/users/{id}', tags: ['users'], request: { params: IdParam }, responses: { 200: json(AdminUserSchema, 'User'), ...errors } }), async (c) =>
  c.json(await getUserAdmin(c.get('deps'), c.req.valid('param').id), 200),
);
r.openapi(
  createRoute({
    method: 'patch',
    path: '/admin/users/{id}/role',
    tags: ['users'],
    request: { params: IdParam, body: body(SetRoleSchema) },
    responses: { 200: json(AdminUserSchema, 'Role set'), ...errors },
  }),
  async (c) => c.json(await setRole(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json').role), 200),
);
r.openapi(
  createRoute({
    method: 'put',
    path: '/admin/users/{id}/cost-center-admin',
    tags: ['users'],
    request: { params: IdParam, body: body(SetCostCenterAdminSchema) },
    responses: { 200: json(AdminUserSchema, 'Assignments replaced'), ...errors },
  }),
  async (c) => c.json(await setCostCenterAdmin(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json').costCenterIds), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/admin/users/{id}/deactivate',
    tags: ['users'],
    request: { params: IdParam },
    responses: { 200: json(AdminUserSchema, 'Deactivated (soft delete)'), ...errors },
  }),
  async (c) => c.json(await deactivateUser(c.get('deps'), c.req.valid('param').id, 'admin', c.get('user').id), 200),
);
r.openapi(
  createRoute({ method: 'post', path: '/admin/users/{id}/reactivate', tags: ['users'], request: { params: IdParam }, responses: { 200: json(AdminUserSchema, 'Reactivated'), ...errors } }),
  async (c) => c.json(await reactivateUser(c.get('deps'), c.req.valid('param').id, c.get('user').id), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/admin/users/{id}/impersonate',
    tags: ['users'],
    description: 'Debugging: act as this user on the current session until DELETE /me/impersonation. Requires IMPERSONATION_ENABLED; audited.',
    request: { params: IdParam },
    responses: { 200: json(okBody, 'Impersonation started'), ...errors },
  }),
  async (c) => {
    await startImpersonation(c.get('deps'), c.get('impersonator') ?? c.get('user'), c.get('sessionId'), c.req.valid('param').id);
    return c.json({ ok: true as const }, 200);
  },
);
r.openapi(
  createRoute({
    method: 'put',
    path: '/admin/users/{id}/budget',
    tags: ['budget'],
    request: { params: IdParam, body: body(SetBudgetSchema) },
    responses: { 200: json(BudgetSchema.nullable(), 'Budget set'), ...errors },
  }),
  async (c) => c.json(await setUserBudget(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('json')), 200),
);
r.openapi(
  createRoute({
    method: 'get',
    path: '/admin/budgets',
    tags: ['budget'],
    request: { query: AdminBudgetsQuery },
    responses: { 200: json(paginated(AdminBudgetRowSchema), 'Budgets and spend per user'), ...errors },
  }),
  async (c) => c.json(await adminBudgets(c.get('deps'), c.req.valid('query')), 200),
);
r.openapi(
  createRoute({
    method: 'get',
    path: '/admin/notifications',
    tags: ['notifications'],
    request: { query: NotificationsQuery },
    responses: { 200: json(paginated(NotificationSchema), 'Sent notifications'), ...errors },
  }),
  async (c) => {
    const q = c.req.valid('query');
    const db = c.get('deps').db;
    const where = and(q.type ? eq(notifications.type, q.type) : undefined, q.status ? eq(notifications.status, q.status) : undefined);
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(notifications).where(where);
    const rows = await db.query.notifications.findMany({ where, orderBy: [desc(notifications.sentAt)], limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
    return c.json(
      {
        items: rows.map((n) => ({ ...n, type: n.type as (typeof NotificationSchema)['_output']['type'], sentAt: n.sentAt.toISOString() })),
        total: Number(total),
        page: q.page,
        pageSize: q.pageSize,
      },
      200,
    );
  },
);

r.openapi(
  createRoute({
    method: 'get',
    path: '/admin/events',
    tags: ['events'],
    description: 'Admin event log: major changes (user, key, budget, cost center, provider), alerts (severity warning, e.g. budget exhausted) and failures (severity error). Newest first.',
    request: { query: AuditEventsQuery },
    responses: { 200: json(paginated(AuditEventSchema), 'Events'), ...errors },
  }),
  async (c) => c.json(await listEvents(c.get('deps'), c.req.valid('query')), 200),
);

// Admin-triggered job runs (useful for ops and tests)
r.openapi(
  createRoute({
    method: 'post',
    path: '/admin/jobs/ingest',
    tags: ['jobs'],
    description: 'Run the LiteLLM log ingest now and re-evaluate all user and cost center budgets. Same as the scheduled job.',
    responses: { 200: json(JobIngestResultSchema, 'Ingest result'), ...errors },
  }),
  async (c) => c.json(await runIngestAndBudgets(c.get('deps')), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/admin/jobs/key-expiry',
    tags: ['jobs'],
    description: 'Run the key expiry check now: warn at 14d and 1d, block expired keys. Same as the scheduled job.',
    responses: { 200: json(JobKeyExpiryResultSchema, 'Key expiry result'), ...errors },
  }),
  async (c) => c.json(await runKeyExpiry(c.get('deps')), 200),
);

export const adminRoutes = r;
