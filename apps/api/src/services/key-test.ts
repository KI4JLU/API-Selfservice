import type { Deps } from '../context.js';
import { ApiError } from '../errors.js';
import { LiteLLMHttpError } from '../litellm/types.js';

/** F-KEY-9: upper bound for the answer, keeps a test request cheap. */
const MAX_TOKENS = 512;

/**
 * LiteLLM errors of calls made with the user's key. The raw LiteLLM body is not passed on
 * (it can echo parts of the key) and these errors do not go to the admin event log.
 */
function keyTestError(e: unknown): unknown {
  if (!(e instanceof LiteLLMHttpError)) return e;
  if (e.status === 401 || e.status === 403) return new ApiError('KEY_INVALID', 'LiteLLM rejected the key');
  return new ApiError('KEY_TEST_FAILED', `LiteLLM answered with status ${e.status}`, { status: e.status });
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
