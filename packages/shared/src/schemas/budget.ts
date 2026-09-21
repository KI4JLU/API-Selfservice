import { z } from 'zod';
import { BUDGET_PERIODS } from '../constants.js';
import { IdSchema, IsoDate, Money } from './common.js';

export const BudgetSchema = z.object({
  amount: Money,
  period: z.enum(BUDGET_PERIODS),
  periodStart: IsoDate.nullable(),
  periodEnd: IsoDate.nullable(),
  assignedBy: IdSchema.nullable(),
  createdAt: IsoDate,
});

export const SetBudgetSchema = z.object({
  amount: Money,
  period: z.enum(BUDGET_PERIODS),
  periodStart: IsoDate.nullable().optional(),
  periodEnd: IsoDate.nullable().optional(),
});

export const SpendSummarySchema = z.object({
  month: z.string(),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  budget: BudgetSchema.nullable(),
  spend: Money,
  remaining: Money.nullable(),
  utilization: z.number().nullable(),
  blocked: z.boolean(),
  metrics: z.object({
    totalRequests: z.number().int(),
    successfulRequests: z.number().int(),
    failedRequests: z.number().int(),
    avgCostPerRequest: Money,
    totalTokens: z.number().int(),
    tokensIn: z.number().int(),
    tokensOut: z.number().int(),
  }),
  daily: z.array(z.object({ date: z.string(), spend: Money, requests: z.number().int() })),
  byKey: z.array(z.object({ keyId: IdSchema.nullable(), keyName: z.string(), spend: Money, requests: z.number().int() })),
  byModel: z.array(z.object({ model: z.string(), spend: Money, requests: z.number().int(), tokens: z.number().int() })),
  byProvider: z.array(z.object({ provider: z.string(), spend: Money, requests: z.number().int(), tokens: z.number().int() })),
  history: z.array(z.object({ month: z.string(), spend: Money })),
});

export const AdminBudgetRowSchema = z.object({
  user: z.object({ id: IdSchema, name: z.string(), email: z.string() }),
  costCenter: z.object({ id: IdSchema, number: z.string(), name: z.string() }),
  budget: BudgetSchema.nullable(),
  spend: Money,
  utilization: z.number().nullable(),
  blocked: z.boolean(),
});

export const AdminBudgetsQuery = z.object({
  costCenterId: IdSchema.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
