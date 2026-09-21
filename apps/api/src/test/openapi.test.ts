import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

describe('openapi / docs / health', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('GET /api/openapi.json is a valid OpenAPI 3.1 document with all v1 routes', async () => {
    const r = await t.request('GET', '/api/openapi.json');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
    const doc = r.body as { openapi: string; info: { title: string }; servers: { url: string }[]; paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('LiteLite API');
    expect(doc.servers).toEqual([{ url: '/' }]);
    // routes are documented with their mount prefix
    const paths = Object.keys(doc.paths).map((p) => p.replace(/^\/api\/v1/, ''));
    expect(paths.length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(doc.paths).every((p) => p.startsWith('/api/v1/'))).toBe(true);
    for (const p of [
      '/me',
      '/me/budget',
      '/me/spend',
      '/me/logs',
      '/cost-centers',
      '/cost-centers/managed',
      '/cost-centers/{id}',
      '/admin/cost-centers',
      '/admin/cost-centers/{id}/archive',
      '/cost-center-requests',
      '/cost-center-requests/{id}/approve',
      '/cost-center-requests/{id}/reject',
      '/api-keys',
      '/api-keys/{id}',
      '/api-keys/{id}/extend',
      '/admin/api-keys',
      '/admin/api-keys/{id}/block',
      '/providers',
      '/admin/providers',
      '/admin/providers/{id}',
      '/admin/providers/sync',
      '/admin/users',
      '/admin/users/{id}',
      '/admin/users/{id}/role',
      '/admin/users/{id}/cost-center-admin',
      '/admin/users/{id}/deactivate',
      '/admin/users/{id}/reactivate',
      '/admin/users/{id}/budget',
      '/admin/budgets',
      '/admin/notifications',
      '/admin/jobs/ingest',
      '/admin/jobs/key-expiry',
      '/reports/cost-centers',
      '/reports/cost-centers/{id}',
    ]) {
      expect(paths, `missing path ${p}`).toContain(p);
    }
    // every operation documents a 200/201 and the error responses
    for (const [p, ops] of Object.entries(doc.paths)) {
      for (const [m, op] of Object.entries(ops)) {
        const codes = Object.keys(op.responses);
        expect(codes.some((c) => c === '200' || c === '201'), `${m} ${p}`).toBe(true);
        expect(codes, `${m} ${p}`).toContain('401');
        expect(codes, `${m} ${p}`).toContain('403');
      }
    }
    expect(doc.paths['/api/v1/me']!.get).toBeDefined();
    expect(doc.paths['/api/v1/me']!.patch).toBeDefined();
    expect(doc.paths['/api/v1/api-keys/{id}']!.delete).toBeDefined();
  });

  it('GET /api/docs serves the Scalar reference', async () => {
    const r = await t.request('GET', '/api/docs');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    expect(String(r.body)).toContain('/api/openapi.json');
  });

  it('GET / is a landing page linking to the web app and the docs (no static web in tests)', async () => {
    const r = await t.request('GET', '/');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    expect(r.body).toContain('/api/docs');
    expect(r.body).toContain(t.deps.env.APP_URL);
  });

  it('GET /health reports LiteLLM state, mode and time', async () => {
    const r = await t.request('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, litellm: true, mode: 'mock', time: t.clock.now.toISOString() });
  });
});
