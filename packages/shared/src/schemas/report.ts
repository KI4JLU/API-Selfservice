import { z } from 'zod';
import { IdSchema, Money } from './common.js';

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
      keys: z.array(z.object({ keyId: IdSchema.nullable(), keyName: z.string(), spend: Money, requests: z.number().int() })),
    }),
  ),
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
