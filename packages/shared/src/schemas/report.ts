import { z } from 'zod';
import { IdSchema, IsoDate, Money } from './common.js';

export const CostCenterReportRowSchema = z.object({
  costCenter: z.object({ id: IdSchema, number: z.string(), name: z.string(), ownerName: z.string(), ownerEmail: z.string() }),
  budget: Money.nullable(),
  spend: Money,
  remaining: Money.nullable(),
  utilization: z.number().nullable(),
  userCount: z.number().int(),
  keyCount: z.number().int(),
  requests: z.number().int(),
});

export const CostCenterReportDetailSchema = z.object({
  summary: CostCenterReportRowSchema,
  users: z.array(
    z.object({
      user: z.object({ id: IdSchema, name: z.string(), email: z.string() }),
      spend: Money,
      requests: z.number().int(),
      /** #13: last request in the range */
      lastUsedAt: IsoDate.nullable(),
      keys: z.array(z.object({ keyId: IdSchema.nullable(), keyName: z.string(), spend: Money, requests: z.number().int(), lastUsedAt: IsoDate.nullable() })),
    }),
  ),
  /** #13: spend per model in the range */
  byModel: z.array(z.object({ model: z.string(), spend: Money, requests: z.number().int(), lastUsedAt: IsoDate.nullable() })),
});

export const ReportQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
