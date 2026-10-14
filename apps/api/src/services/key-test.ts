import type { Deps } from '../context.js';
import { ApiError } from '../errors.js';
import { LiteLLMHttpError } from '../litellm/types.js';

/** F-KEY-9: upper bound for the answer, keeps a test request cheap. */
const MAX_TOKENS = 512;

/**
 * Errors of calls made with the user's key. Neither the raw LiteLLM body nor any other error text is
 * passed on, since both can contain the key (e.g. fetch rejects a malformed Authorization header with
 * its value in the message). These errors do not go to the server log or the admin event log.
 */
function keyTestError(e: unknown): ApiError {
  if (!(e instanceof LiteLLMHttpError)) return new ApiError('KEY_TEST_FAILED', 'LiteLLM could not be called');
  if (isProviderError(e.body)) return new ApiError('KEY_TEST_PROVIDER_ERROR', 'The provider behind the model rejected the request', { status: e.status });
  if (e.status === 401 || e.status === 403) return new ApiError('KEY_INVALID', 'LiteLLM rejected the key');
  return new ApiError('KEY_TEST_FAILED', `LiteLLM answered with status ${e.status}`, { status: e.status });
}

/**
 * Errors raised by the provider behind a model (e.g. a wrong upstream API key in the proxy config) come back
 * with the same 401 as a rejected portal key, but LiteLLM prefixes their message with its exception class
 * (`litellm.AuthenticationError: ... OpenAIException ...`). Errors of the proxy's own key check have no prefix.
 */
function isProviderError(body: string) {
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    return typeof message === 'string' && /^litellm\.\w+Error:/.test(message);
  } catch {
    return false;
  }
}

/** F-KEY-9: models the given key may call. */
export async function listKeyTestModels(deps: Deps, key: string) {
  try {
    const models = await deps.litellm.listKeyModels(key);
    return { models: [...new Set(models)].sort() };
  } catch (e) {
    throw keyTestError(e);
  }
}

/** F-KEY-9: sends one prompt with the given key and returns the answer; nothing is stored. */
export async function runKeyTest(deps: Deps, input: { key: string; model: string; prompt: string }) {
  const started = performance.now();
  try {
    const r = await deps.litellm.chatWithKey(input.key, { model: input.model, prompt: input.prompt, maxTokens: MAX_TOKENS });
    return {
      model: r.model,
      answer: r.answer,
      durationMs: Math.round(performance.now() - started),
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
    };
  } catch (e) {
    throw keyTestError(e);
  }
}
