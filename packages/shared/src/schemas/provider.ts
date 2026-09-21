import { z } from 'zod';
import { PROVIDER_TIERS } from '../constants.js';
import { IdSchema, IsoDate } from './common.js';

export const ProviderSchema = z.object({
  id: IdSchema,
  modelName: z.string(),
  litellmModelId: z.string().nullable(),
  provider: z.string().nullable(),
  tier: z.enum(PROVIDER_TIERS),
  displayNameDe: z.string().nullable(),
  displayNameEn: z.string().nullable(),
  descriptionDe: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  /** price per token as reported by LiteLLM; null when LiteLLM has no price for the model */
  inputCostPerToken: z.number().nullable(),
  outputCostPerToken: z.number().nullable(),
  available: z.boolean(),
  lastSeenAt: IsoDate.nullable(),
});

export const UpdateProviderSchema = z.object({
  tier: z.enum(PROVIDER_TIERS).optional(),
  displayNameDe: z.string().max(200).nullable().optional(),
  displayNameEn: z.string().max(200).nullable().optional(),
  descriptionDe: z.string().max(2000).nullable().optional(),
  descriptionEn: z.string().max(2000).nullable().optional(),
});

export const ProviderSyncResult = z.object({ added: z.number().int(), updated: z.number().int(), unavailable: z.number().int() });
