import { z } from 'zod';
import { KEY_BUDGET_PERIODS, KEY_STATUS } from '../constants.js';
import { IdSchema, IsoDate, Money } from './common.js';

export const ApiKeySchema = z.object({
  id: IdSchema,
  name: z.string(),
  maskedKey: z.string(),
  costCenter: z.object({ id: IdSchema, number: z.string(), name: z.string() }),
  models: z.array(z.string()),
  /** F-KEY-10: providers whose current and future models are added to the key automatically */
  providers: z.array(z.string()),
  budget: Money.nullable(),
  /** F-KEY-11: `monthly` resets the budget every month; null = once for the key's lifetime */
  budgetPeriod: z.enum(KEY_BUDGET_PERIODS).nullable(),
  /** Spend in the current month for monthly budgets, otherwise since creation */
  spend: Money,
  status: z.enum(KEY_STATUS),
  createdAt: IsoDate,
  expiresAt: IsoDate,
  lastExtendedAt: IsoDate.nullable(),
});

export const AdminApiKeySchema = ApiKeySchema.extend({
  user: z.object({ id: IdSchema, name: z.string(), email: z.string() }),
});

export const CreateApiKeySchema = z
  .object({
    name: z.string().min(1).max(100),
    models: z.array(z.string()).default([]),
    /** F-KEY-10: all current and future models of these providers */
    providers: z.array(z.string()).default([]),
    costCenterId: IdSchema,
    budget: Money.nullable().optional(),
    budgetPeriod: z.enum(KEY_BUDGET_PERIODS).nullable().optional(),
  })
  .refine((v) => v.models.length > 0 || v.providers.length > 0, { message: 'Select at least one model or provider', path: ['models'] });

export const CreatedApiKeySchema = ApiKeySchema.extend({
  /** Plaintext key, shown exactly once. */
  secret: z.string(),
});

export const UpdateApiKeySchema = z.object({
  budget: Money.nullable().optional(),
  budgetPeriod: z.enum(KEY_BUDGET_PERIODS).nullable().optional(),
  name: z.string().min(1).max(100).optional(),
});

export const AdminApiKeysQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  userId: IdSchema.optional(),
  costCenterId: IdSchema.optional(),
  status: z.enum(KEY_STATUS).optional(),
});
