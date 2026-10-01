import { z } from 'zod';

/** F-KEY-9: the plaintext key is only forwarded to LiteLLM, never stored or logged. */
const KeySecret = z.string().trim().min(1).max(200);

export const KeyTestModelsRequestSchema = z.object({ key: KeySecret });

export const KeyTestModelsSchema = z.object({
  /** Model names the key may call, as LiteLLM reports them (`/v1/models`). */
  models: z.array(z.string()),
});

export const KeyTestRequestSchema = z.object({
  key: KeySecret,
  model: z.string().min(1).max(200),
  prompt: z.string().trim().min(1).max(2000),
});

export const KeyTestResultSchema = z.object({
  /** Model that answered (LiteLLM may resolve an alias). */
  model: z.string(),
  answer: z.string(),
  durationMs: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
});
