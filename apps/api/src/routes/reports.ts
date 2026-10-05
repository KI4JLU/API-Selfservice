import { createRoute, z } from '@hono/zod-openapi';
import { CostCenterReportDetailSchema, CostCenterReportRowSchema, ReportQuery } from '@api-selfservice/shared';
import { createRouter, json, errors, IdParam } from './_util.js';
import { costCenterReport, costCenterReportDetail } from '../services/reports.js';
import { requireCostCenterAdmin } from '../middleware/roles.js';

const r = createRouter();
r.use('/reports/*', requireCostCenterAdmin);

r.openapi(
  createRoute({
    method: 'get',
    path: '/reports/cost-centers',
    tags: ['reports'],
    request: { query: ReportQuery },
    responses: { 200: json(z.array(CostCenterReportRowSchema), 'Budget usage per cost center'), ...errors },
  }),
  async (c) => c.json(await costCenterReport(c.get('deps'), c.get('user'), c.req.valid('query')), 200),
);
r.openapi(
  createRoute({
    method: 'get',
    path: '/reports/cost-centers/{id}',
    tags: ['reports'],
    request: { params: IdParam, query: ReportQuery },
    responses: { 200: json(CostCenterReportDetailSchema, 'Drill-down per user and key'), ...errors },
  }),
  async (c) => c.json(await costCenterReportDetail(c.get('deps'), c.get('user'), c.req.valid('param').id, c.req.valid('query')), 200),
);

export const reportRoutes = r;
