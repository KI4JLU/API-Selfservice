import { createRoute, z } from '@hono/zod-openapi';
import { SapExportPreviewSchema, SapExportRequestSchema, SapExportSchema, SapExportSettingsSchema, UpdateSapExportSettingsSchema } from '@api-selfservice/shared';
import { createRouter, body, json, errors, IdParam } from './_util.js';
import { createSapExport, getSapSettings, listSapExports, sapExportFile, sapExportPreview, setSapSettings } from '../services/sap-export.js';
import { requireAdmin } from '../middleware/roles.js';

// ---------- #14: SAP export of the API costs, admins only ----------

const r = createRouter();
r.use('/admin/sap-export/*', requireAdmin);
r.use('/admin/sap-exports', requireAdmin);
r.use('/admin/sap-exports/*', requireAdmin);

r.openapi(
  createRoute({ method: 'get', path: '/admin/sap-export/settings', tags: ['sap-export'], responses: { 200: json(SapExportSettingsSchema, 'Sender cost center (KoSt alt)'), ...errors } }),
  async (c) => c.json(await getSapSettings(c.get('deps')), 200),
);
r.openapi(
  createRoute({
    method: 'put',
    path: '/admin/sap-export/settings',
    tags: ['sap-export'],
    request: { body: body(UpdateSapExportSettingsSchema) },
    responses: { 200: json(SapExportSettingsSchema, 'Saved'), ...errors },
  }),
  async (c) => c.json(await setSapSettings(c.get('deps'), c.get('user'), c.req.valid('json').senderCostCenter), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/admin/sap-export/preview',
    tags: ['sap-export'],
    description: 'Rows of the CSV for a billing month, in CSV column order; nothing is stored.',
    request: { body: body(SapExportRequestSchema) },
    responses: { 200: json(SapExportPreviewSchema, 'Preview'), ...errors },
  }),
  async (c) => c.json(await sapExportPreview(c.get('deps'), c.req.valid('json')), 200),
);
r.openapi(
  createRoute({
    method: 'post',
    path: '/admin/sap-exports',
    tags: ['sap-export'],
    description: 'Creates the export and keeps the CSV; download it from /admin/sap-exports/{id}/csv.',
    request: { body: body(SapExportRequestSchema) },
    responses: { 201: json(SapExportSchema, 'Created'), ...errors },
  }),
  async (c) => c.json(await createSapExport(c.get('deps'), c.get('user'), c.req.valid('json')), 201),
);
r.openapi(
  createRoute({ method: 'get', path: '/admin/sap-exports', tags: ['sap-export'], responses: { 200: json(z.array(SapExportSchema), 'Previous exports, newest first'), ...errors } }),
  async (c) => c.json(await listSapExports(c.get('deps')), 200),
);
r.openapi(
  createRoute({
    method: 'get',
    path: '/admin/sap-exports/{id}/csv',
    tags: ['sap-export'],
    description: 'The CSV of an export: `;`, decimal comma, header row, Windows-1252.',
    request: { params: IdParam },
    responses: { 200: { description: 'CSV file', content: { 'text/csv': { schema: z.string() } } }, ...errors },
  }),
  async (c) => {
    const f = await sapExportFile(c.get('deps'), c.req.valid('param').id);
    return c.body(f.bytes.buffer as ArrayBuffer, 200, { 'Content-Type': 'text/csv; charset=windows-1252', 'Content-Disposition': `attachment; filename="${f.filename}"` });
  },
);

export const sapExportRoutes = r;
