import { createRoute } from '@hono/zod-openapi';
import { MeSchema, UpdateMeSchema, BudgetSchema, SpendSummarySchema, MonthQuery, LogsQuery, RequestLogSchema, paginated } from '@api-selfservice/shared';
import type { Context } from 'hono';
import type { AppEnv } from '../context.js';
import { createRouter, body, json, errors, okBody } from './_util.js';
import { getMe, updateMe } from '../services/users.js';
import { stopImpersonation } from '../services/impersonation.js';
import { forbidden } from '../errors.js';
import { getMyBudget, spendSummary } from '../services/budgets.js';
import { listLogs } from '../services/logs.js';

/** Impersonation state of the request, appended to every MeSchema response. */
function impersonation(c: Context<AppEnv>) {
  const imp = c.get('impersonator');
  return { impersonatedBy: imp ? { id: imp.id, name: imp.name, email: imp.email } : null, impersonationEnabled: c.get('deps').env.IMPERSONATION_ENABLED };
}

export const meRoutes = createRouter()
  .openapi(createRoute({ method: 'get', path: '/me', tags: ['me'], responses: { 200: json(MeSchema, 'Current user'), ...errors } }), async (c) =>
    c.json({ ...(await getMe(c.get('deps'), c.get('user'))), ...impersonation(c) }, 200),
  )
  .openapi(
    createRoute({
      method: 'patch',
      path: '/me',
      tags: ['me'],
      request: { body: body(UpdateMeSchema) },
      responses: { 200: json(MeSchema.extend({ requestCreated: MeSchema.shape.pendingRequest.unwrap().pick({ number: true }).nullable() }), 'Updated'), ...errors },
    }),
    async (c) => {
      const r = await updateMe(c.get('deps'), c.get('user'), c.req.valid('json'));
      return c.json({ ...r.me, ...impersonation(c), requestCreated: r.requestCreated }, 200);
    },
  )
  .openapi(
    createRoute({
      method: 'delete',
      path: '/me/impersonation',
      tags: ['me'],
      description: 'Ends an admin impersonation on the current session (the caller becomes the admin again).',
      responses: { 200: json(okBody, 'Impersonation ended'), ...errors },
    }),
    async (c) => {
      const imp = c.get('impersonator');
      if (!imp) throw forbidden('Not impersonating');
      await stopImpersonation(c.get('deps'), imp, c.get('sessionId'), c.get('user').id);
      return c.json({ ok: true as const }, 200);
    },
  )
  .openapi(createRoute({ method: 'get', path: '/me/budget', tags: ['budget'], responses: { 200: json(BudgetSchema.nullable(), 'My budget'), ...errors } }), async (c) =>
    c.json(await getMyBudget(c.get('deps'), c.get('user')), 200),
  )
  .openapi(
    createRoute({
      method: 'get',
      path: '/me/spend',
      tags: ['budget'],
      request: { query: MonthQuery },
      responses: { 200: json(SpendSummarySchema, 'Spend summary for dashboard'), ...errors },
    }),
    async (c) => c.json(await spendSummary(c.get('deps'), c.get('user'), c.req.valid('query').month), 200),
  )
  .openapi(
    createRoute({
      method: 'get',
      path: '/me/logs',
      tags: ['logs'],
      request: { query: LogsQuery },
      responses: { 200: json(paginated(RequestLogSchema), 'Own request logs (metadata only)'), ...errors },
    }),
    async (c) => c.json(await listLogs(c.get('deps'), c.get('user').id, c.req.valid('query')), 200),
  );
