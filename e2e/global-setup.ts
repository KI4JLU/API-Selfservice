import { request } from '@playwright/test';

type Provider = { id: string; modelName: string; tier: 'free' | 'paid'; available: boolean };

/**
 * The mock suite runs in its own schema, where every synced model starts as `paid`. The default cost center
 * offers free models only (F-KST-9), so one model without prices (gemma-local) is released as free.
 */
export default async function globalSetup() {
  const api = await request.newContext({ baseURL: 'http://localhost:3030', extraHTTPHeaders: { Origin: 'http://localhost:5173' } });
  const login = await api.post('/api/auth/dev-login', { data: { email: 'e2e-setup-admin@example.com', name: 'E2E Setup Admin', admin: true } });
  if (login.status() !== 200) throw new Error(`dev login failed: ${await login.text()}`);
  const providers = (await (await api.get('/api/v1/admin/providers')).json()) as Provider[];
  if (!providers.some((p) => p.available && p.tier === 'free')) {
    const gemma = providers.find((p) => p.modelName === 'gemma-local');
    if (!gemma) throw new Error('mock model gemma-local not found; is the API running with LITELLM_MODE=mock?');
    const r = await api.patch(`/api/v1/admin/providers/${gemma.id}`, { data: { tier: 'free' } });
    if (r.status() !== 200) throw new Error(`could not release gemma-local as free: ${await r.text()}`);
  }
  await api.dispose();
}
