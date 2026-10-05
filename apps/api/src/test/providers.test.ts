import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderSchema, ProviderSyncResult } from '@api-selfservice/shared';
import { z } from 'zod';
import { approvedCostCenterFor, createTestApp, expectError, expectShape, type Client, type TestApp } from './harness.js';

describe('providers', () => {
  let t: TestApp;
  let admin: Client;
  let user: Client;
  let defaultId: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    user = await t.login();
    defaultId = (await user.get('/me')).body.costCenter.id;
  });
  afterAll(() => t.close());

  it('sync from the mock adds 5 models, all paid', async () => {
    const r = await admin.post('/admin/providers/sync');
    expect(r.status).toBe(200);
    expect(expectShape(ProviderSyncResult, r.body)).toEqual({ added: 5, updated: 0, unavailable: 0 });
    const list = expectShape(z.array(ProviderSchema), (await admin.get('/admin/providers')).body);
    expect(list).toHaveLength(5);
    expect(list.every((p) => p.tier === 'paid' && p.available)).toBe(true);
    // sorted by provider, then model
    expect(list.map((p) => [p.provider, p.modelName])).toEqual([
      ['anthropic', 'claude-opus-5'],
      ['anthropic', 'claude-sonnet-5'],
      ['hosted_vllm', 'gemma-local'],
      ['openai', 'gpt-4o'],
      ['openai', 'gpt-4o-mini'],
    ]);
    expect(list.find((p) => p.modelName === 'gemma-local')).toMatchObject({ provider: 'hosted_vllm', litellmModelId: 'm-gemma', inputCostPerToken: null, outputCostPerToken: null });
    expect(list.find((p) => p.modelName === 'gpt-4o')).toMatchObject({ inputCostPerToken: 0.0000025, outputCostPerToken: 0.00001 });
    // second sync is idempotent
    expect((await admin.post('/admin/providers/sync')).body).toEqual({ added: 0, updated: 5, unavailable: 0 });
  });

  it('user on the default cost center sees nothing while everything is paid', async () => {
    expect((await user.get('/providers')).body).toEqual([]);
  });

  it('admin sets one model free with display names', async () => {
    const list = (await admin.get('/admin/providers')).body as { id: string; modelName: string }[];
    const gemma = list.find((p) => p.modelName === 'gemma-local')!;
    const r = await admin.patch(`/admin/providers/${gemma.id}`, { tier: 'free', displayNameDe: 'Gemma (lokal)', displayNameEn: 'Gemma (local)', descriptionEn: 'Runs on campus' });
    expect(r.status).toBe(200);
    const p = expectShape(ProviderSchema, r.body);
    expect(p).toMatchObject({ tier: 'free', displayNameDe: 'Gemma (lokal)', displayNameEn: 'Gemma (local)', descriptionEn: 'Runs on campus', descriptionDe: null });
    expectError(await admin.patch(`/admin/providers/${gemma.id}`, { tier: 'gold' }), 400, 'VALIDATION_ERROR');
    expectError(await admin.patch('/admin/providers/nope', { tier: 'free' }), 404, 'NOT_FOUND');
  });

  it('user on the default cost center sees only free models', async () => {
    const r = await user.get('/providers');
    const list = expectShape(z.array(ProviderSchema), r.body);
    expect(list.map((p) => p.modelName)).toEqual(['gemma-local']);
  });

  it('user with an approved cost center sees all models', async () => {
    const u2 = await t.login();
    const cc = await approvedCostCenterFor(t, admin, u2);
    const list = expectShape(z.array(ProviderSchema), (await u2.get('/providers')).body);
    expect(list).toHaveLength(5);
    // explicit costCenterId query
    expect((await u2.get(`/providers?costCenterId=${cc.id}`)).body).toHaveLength(5);
    expect((await u2.get(`/providers?costCenterId=${defaultId}`)).body).toHaveLength(1);
    // a pending cost center only allows free models
    const u3 = await t.login();
    await u3.patch('/me', { costCenterNumber: '23456789' });
    const pending = (await admin.get('/cost-centers?status=pending')).body.items.find((c: { number: string }) => c.number === '23456789');
    expect((await admin.get(`/providers?costCenterId=${pending.id}`)).body).toHaveLength(1);
    // the requester is no member (yet), so the cost center's models are not listed for them
    expectError(await u3.get(`/providers?costCenterId=${pending.id}`), 403, 'FORBIDDEN');
  });

  it('creating a key with a paid model on the default cost center -> PAID_MODEL_REQUIRES_COST_CENTER', async () => {
    expectError(await user.post('/api-keys', { name: 'k', models: ['gpt-4o'], costCenterId: defaultId }), 409, 'PAID_MODEL_REQUIRES_COST_CENTER');
    expectError(await user.post('/api-keys', { name: 'k', models: ['gemma-local', 'claude-opus-5'], costCenterId: defaultId }), 409, 'PAID_MODEL_REQUIRES_COST_CENTER');
  });

  it('unknown model -> MODEL_NOT_ALLOWED', async () => {
    expectError(await user.post('/api-keys', { name: 'k', models: ['does-not-exist'], costCenterId: defaultId }), 409, 'MODEL_NOT_ALLOWED');
    const u2 = await t.login();
    const cc = await approvedCostCenterFor(t, admin, u2);
    expectError(await u2.post('/api-keys', { name: 'k', models: ['gpt-4o', 'does-not-exist'], costCenterId: cc.id }), 409, 'MODEL_NOT_ALLOWED');
  });

  it('free model works on the default cost center', async () => {
    const r = await user.post('/api-keys', { name: 'free', models: ['gemma-local'], costCenterId: defaultId });
    expect(r.status).toBe(201);
    expect(r.body.models).toEqual(['gemma-local']);
  });

  it('models that disappear from LiteLLM become unavailable and are hidden', async () => {
    const original = t.mock.listModels;
    t.mock.listModels = async () => (await original()).filter((m) => m.modelName !== 'gemma-local');
    try {
      expect((await admin.post('/admin/providers/sync')).body).toEqual({ added: 0, updated: 4, unavailable: 1 });
      expect((await user.get('/providers')).body).toEqual([]);
      const adminList = (await admin.get('/admin/providers')).body as { modelName: string; available: boolean }[];
      expect(adminList.find((p) => p.modelName === 'gemma-local')?.available).toBe(false);
      expectError(await user.post('/api-keys', { name: 'k', models: ['gemma-local'], costCenterId: defaultId }), 409, 'MODEL_NOT_ALLOWED');
    } finally {
      t.mock.listModels = original;
    }
    expect((await admin.post('/admin/providers/sync')).body).toEqual({ added: 0, updated: 5, unavailable: 0 });
    expect((await user.get('/providers')).body).toHaveLength(1);
  });
});
