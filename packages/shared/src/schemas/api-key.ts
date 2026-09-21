import { z } from 'zod';
import { KEY_STATUS } from '../constants.js';
import { IdSchema, IsoDate, Money } from './common.js';

export const ApiKeySchema = z.object({
  id: IdSchema,
  name: z.string(),
  maskedKey: z.string(),
  costCenter: z.object({ id: IdSchema, number: z.string(), name: z.string() }),
  models: z.array(z.string()),
  budget: Money.nullable(),
  spend: Money,
  status: z.enum(KEY_STATUS),
  createdAt: IsoDate,
  expiresAt: IsoDate,
  lastExtendedAt: IsoDate.nullable(),
});

export const AdminApiKeySchema = ApiKeySchema.extend({
  user: z.object({ id: IdSchema, name: z.string(), email: z.string() }),
});

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  models: z.array(z.string()).min(1),
  costCenterId: IdSchema,
  budget: Money.nullable().optional(),
});

export const CreatedApiKeySchema = ApiKeySchema.extend({
  /** Plaintext key, shown exactly once. */
  secret: z.string(),
});

export const UpdateApiKeySchema = z.object({
  budget: Money.nullable().optional(),
  name: z.string().min(1).max(100).optional(),
});

export const AdminApiKeysQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  userId: IdSchema.optional(),
  costCenterId: IdSchema.optional(),
  status: z.enum(KEY_STATUS).optional(),
});
