import type { Env } from '../env.js';
import { createHttpAdapter } from './http.js';
import { createMockAdapter } from './mock.js';
import type { LiteLLMAdapter } from './types.js';

export * from './types.js';
export { createHttpAdapter, createMockAdapter };

export function createLiteLLM(env: Env): LiteLLMAdapter {
  if (env.LITELLM_MODE === 'mock') return createMockAdapter({ seedLogs: true });
  return createHttpAdapter({ baseUrl: env.LITELLM_BASE_URL, apiKey: env.LITELLM_API_KEY });
}
