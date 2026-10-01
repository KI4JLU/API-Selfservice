import { z } from 'zod';
import { COST_CENTER_MEMBER_ROLES, EFFECTIVE_ROLES, ROLES } from '../constants.js';
import { IdSchema, IsoDate, LocaleSchema, Money } from './common.js';

export const CostCenterRef = z.object({
  id: IdSchema,
  number: z.string().length(8),
  name: z.string(),
});

export const MeSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  name: z.string(),
  role: z.enum(ROLES),
  effectiveRole: z.enum(EFFECTIVE_ROLES),
  roleFromIdp: z.boolean(),
  locale: LocaleSchema,
  costCenter: CostCenterRef,
  costCenterOwnerName: z.string().nullable(),
  costCenterOwnerEmail: z.string().email().nullable(),
  managedCostCenters: z.array(CostCenterRef),
  /** Approved cost centers the user may create keys on: the default plus every membership (F-KST-10). */
  memberCostCenters: z.array(CostCenterRef.extend({ role: z.enum(COST_CENTER_MEMBER_ROLES) })),
  pendingRequest: z
    .object({
      id: IdSchema,
      number: z.string().length(8),
      name: z.string(),
      status: z.enum(['pending', 'approved', 'rejected']),
      reason: z.string().nullable(),
      createdAt: IsoDate,
    })
    .nullable(),
  /** Set while an admin acts as this user (debugging). */
  impersonatedBy: z.object({ id: IdSchema, name: z.string(), email: z.string().email() }).nullable(),
  /** Whether admins may impersonate users on this instance (IMPERSONATION_ENABLED). */
  impersonationEnabled: z.boolean(),
});

export const UpdateMeSchema = z.object({
  locale: LocaleSchema.optional(),
  /** 8 digits, spaces allowed */
  costCenterNumber: z.string().min(8).max(9).optional(),
  costCenterOwnerName: z.string().max(200).nullable().optional(),
  costCenterOwnerEmail: z.string().email().nullable().optional(),
});

export const AdminUserSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  name: z.string(),
  role: z.enum(ROLES),
  roleFromIdp: z.boolean(),
  locale: LocaleSchema,
  costCenter: CostCenterRef,
  managedCostCenters: z.array(CostCenterRef),
  budget: z
    .object({ amount: Money, period: z.enum(['monthly', 'yearly', 'project']), periodStart: IsoDate.nullable(), periodEnd: IsoDate.nullable() })
    .nullable(),
  spendCurrentPeriod: Money,
  keyCount: z.number().int(),
  status: z.enum(['active', 'deactivated']),
  deletedAt: IsoDate.nullable(),
  deletedReason: z.enum(['admin', 'affiliation']).nullable(),
  lastLoginAt: IsoDate.nullable(),
  createdAt: IsoDate,
});

export const AdminUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().optional(),
  costCenterId: IdSchema.optional(),
  includeDeactivated: z.coerce.boolean().default(false),
});

export const SetRoleSchema = z.object({ role: z.enum(ROLES) });

/** A user as LiteLLM knows it (LiteLLM is the user master, E-7), with the matching API-Selfservice account if any. */
export const LitellmUserSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  alias: z.string().nullable(),
  maxBudget: z.number().nullable(),
  spend: z.number(),
  blocked: z.boolean(),
  teams: z.array(z.string()),
  apiSelfservice: z.object({ id: IdSchema, name: z.string(), status: z.enum(['active', 'deactivated']) }).nullable(),
});

export const LitellmUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  /** E-mail (substring, case-insensitive) or a full user id. */
  q: z.string().optional(),
});
export const SetCostCenterAdminSchema = z.object({ costCenterIds: z.array(IdSchema) });
