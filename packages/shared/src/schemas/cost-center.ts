import { z } from 'zod';
import { BUDGET_PERIODS, COST_CENTER_STATUS } from '../constants.js';
import { IdSchema, IsoDate, Money } from './common.js';

export const CostCenterSchema = z.object({
  id: IdSchema,
  number: z.string().length(8),
  name: z.string(),
  ownerName: z.string(),
  ownerEmail: z.string().email(),
  maxBudget: Money.nullable(),
  budgetPeriod: z.enum(BUDGET_PERIODS).nullable(),
  periodStart: IsoDate.nullable(),
  periodEnd: IsoDate.nullable(),
  status: z.enum(COST_CENTER_STATUS),
  isDefault: z.boolean(),
  spendCurrentPeriod: Money,
  blocked: z.boolean(),
  requestedBy: IdSchema.nullable(),
  approvedBy: IdSchema.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});

export const CostCenterListQuery = z.object({
  status: z.enum(COST_CENTER_STATUS).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const CreateCostCenterRequestSchema = z.object({
  number: z.string().min(8).max(9),
  name: z.string().min(1).max(200),
  ownerName: z.string().min(1).max(200),
  ownerEmail: z.string().email(),
});

export const AdminCreateCostCenterSchema = CreateCostCenterRequestSchema.extend({
  maxBudget: Money.nullable().optional(),
  budgetPeriod: z.enum(BUDGET_PERIODS).nullable().optional(),
  periodStart: IsoDate.nullable().optional(),
  periodEnd: IsoDate.nullable().optional(),
});

export const UpdateCostCenterSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  ownerName: z.string().min(1).max(200).optional(),
  ownerEmail: z.string().email().optional(),
  maxBudget: Money.nullable().optional(),
  budgetPeriod: z.enum(BUDGET_PERIODS).nullable().optional(),
  periodStart: IsoDate.nullable().optional(),
  periodEnd: IsoDate.nullable().optional(),
});

export const CostCenterRequestSchema = z.object({
  id: IdSchema,
  user: z.object({ id: IdSchema, name: z.string(), email: z.string() }),
  costCenter: z.object({ id: IdSchema, number: z.string(), name: z.string(), ownerName: z.string(), ownerEmail: z.string() }),
  status: z.enum(['pending', 'approved', 'rejected']),
  reason: z.string().nullable(),
  decidedBy: IdSchema.nullable(),
  decidedAt: IsoDate.nullable(),
  createdAt: IsoDate,
});

export const RejectSchema = z.object({ reason: z.string().min(1).max(1000) });
