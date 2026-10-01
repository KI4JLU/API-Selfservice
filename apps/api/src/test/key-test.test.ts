import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KeyTestModelsSchema, KeyTestResultSchema } from '@api-selfservice/shared';
import { LiteLLMHttpError } from '../litellm/types.js';
import { createTestApp, expectError, expectShape, syncProvidersWithFree, type Client, type TestApp } from './harness.js';

describe('key test (F-KEY-9)', () => {
  let t: TestApp;
  let admin: Client;
  let user: Client;
  let secret: string;
  let litellmKeyId: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.login({ admin: true });
    await syncProvidersWithFree(admin);
    user = await t.login();
    const costCenterId = (await user.get('/me')).body.costCenter.id;
    const k = await user.post('/api-keys', { name: 'test', models: ['gemma-local'], costCenterId });
    expect(k.status).toBe(201);
    secret = k.body.secret;
    litellmKeyId = (await t.keyRow(k.body.id)).litellmKeyId;
  });
  afterAll(() => t.close());

  const send = (body: Record<string, unknown> = {}, c: Client = user) => c.post('/key-test', { key: secret, model: 'gemma-local', prompt: 'Say hello', ...body });

  it('lists the models of the key', async () => {
    const r = await user.post('/key-test/models', { key: secret });
    expect(r.status).toBe(200);
    expect(expectShape(KeyTestModelsSchema, r.body)).toEqual({ models: ['gemma-local'] });
  });

  it('sends the prompt with the key and returns the answer', async () => {
    const before = t.mock.logs.length;
    const r = await send();
    expect(r.status).toBe(200);
    const res = expectShape(KeyTestResultSchema, r.body);
    expect(res).toMatchObject({ model: 'gemma-local', answer: 'Mock answer from gemma-local.', promptTokens: 3, completionTokens: 8 });
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    // the test request runs on the key in LiteLLM like any other request
    expect(t.mock.logs.length).toBe(before + 1);
  });

  it('works with any valid key, also one of another user', async () => {
    const other = await t.login();
    expect((await send({}, other)).status).toBe(200);
  });

  it('reports unknown and blocked keys and models outside the key as KEY_INVALID', async () => {
    expectError(await user.post('/key-test/models', { key: 'sk-unknown' }), 422, 'KEY_INVALID');
    expectError(await send({ key: 'sk-unknown' }), 422, 'KEY_INVALID');
    expectError(await send({ model: 'gpt-4o' }), 422, 'KEY_INVALID');
    t.mock.keys.get(litellmKeyId)!.blocked = true;
    try {
      expectError(await send(), 422, 'KEY_INVALID');
    } finally {
      t.mock.keys.get(litellmKeyId)!.blocked = false;
    }
  });

  it('maps other LiteLLM errors to KEY_TEST_FAILED without the raw body', async () => {
    const spy = vi.spyOn(t.mock, 'chatWithKey').mockRejectedValueOnce(new LiteLLMHttpError(400, `Budget exceeded for ${secret}`, '/v1/chat/completions'));
    const r = await send();
    spy.mockRestore();
    expectError(r, 502, 'KEY_TEST_FAILED');
    expect(r.body.details).toEqual({ status: 400 });
    expect(JSON.stringify(r.body)).not.toContain(secret);
    // user errors, not system errors: nothing in the admin event log
    const events = await admin.get('/admin/events?entity=request&pageSize=200');
    expect(events.status).toBe(200);
    expect(JSON.stringify(events.body)).not.toContain('/key-test');
  });

  it('validates the body and requires a session', async () => {
    expectError(await send({ key: '' }), 400, 'VALIDATION_ERROR');
    expectError(await send({ model: '' }), 400, 'VALIDATION_ERROR');
    expectError(await send({ prompt: ' ' }), 400, 'VALIDATION_ERROR');
    expectError(await send({ prompt: 'x'.repeat(2001) }), 400, 'VALIDATION_ERROR');
    expectError(await t.anonymous().post('/key-test', { key: secret, model: 'gemma-local', prompt: 'x' }), 401, 'UNAUTHORIZED');
    expectError(await t.anonymous().post('/key-test/models', { key: secret }), 401, 'UNAUTHORIZED');
  });
});
