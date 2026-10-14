import { z } from 'zod';
import { BUDGET_PERIODS, COST_CENTER_MEMBER_ROLES, COST_CENTER_STATUS, KEY_BUDGET_PERIODS } from '../constants.js';
import { IdSchema, IsoDate, Money } from './common.js';

export const CostCenterSchema = z.object({
  id: IdSchema,
  number: z.string().length(8),
  name: z.string(),
  ownerName: z.string(),
  ownerEmail: z.string().email(),
  /** LiteLLM user id of the owner, who is always a cost center admin (F-KST-14); null = not linked yet (legacy data, default cost center) */
  ownerUserId: z.string().nullable(),
  maxBudget: Money.nullable(),
  budgetPeriod: z.enum(BUDGET_PERIODS).nullable(),
  periodStart: IsoDate.nullable(),
  periodEnd: IsoDate.nullable(),
  /** #15: budget per member without an individual one; null = unlimited */
  memberBudget: Money.nullable(),
  /** #15: `monthly` resets member budgets every month; null = once */
  memberBudgetPeriod: z.enum(KEY_BUDGET_PERIODS).nullable(),
  /** F-KST-15: models released for the cost center (= LiteLLM team models); empty = all models of its tier class */
  models: z.array(z.string()),
  status: z.enum(COST_CENTER_STATUS),
  isDefault: z.boolean(),
  spendCurrentPeriod: Money,
  blocked: z.boolean(),
  requestedBy: IdSchema.nullable(),
  approvedBy: IdSchema.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});

/**
 * What users see of cost centers they do not manage: no budget, spend or owner data (F-KST-8).
 * Admins and the cost center's own admins get the full CostCenterSchema.
 */
export const CostCenterLookupSchema = CostCenterSchema.pick({ id: true, number: true, name: true, isDefault: true, status: true });

/** Full view for admins and managers of the cost center, lookup view otherwise. */
export const CostCenterOrLookupSchema = z.union([CostCenterSchema, CostCenterLookupSchema]);

export const CostCenterListQuery = z.object({
  status: z.enum(COST_CENTER_STATUS).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const CreateCostCenterRequestSchema = z.object({
  number: z.string().min(8).max(9),
  name: z.string().min(1).max(200),
  /** Must belong to a LiteLLM user, who becomes owner and cost center admin on approval (F-KST-14). */
  ownerEmail: z.string().email(),
});

/** A cost center budget of 0 would block the team and all its keys right away; no budget = unlimited. */
const CostCenterBudget = z.number().positive();

export const AdminCreateCostCenterSchema = z.object({
  number: z.string().min(8).max(9),
  name: z.string().min(1).max(200),
  /** LiteLLM user id (GET /admin/litellm-users); becomes cost center admin (F-KST-14). */
  ownerUserId: z.string().min(1),
  maxBudget: CostCenterBudget.nullable().optional(),
  budgetPeriod: z.enum(BUDGET_PERIODS).nullable().optional(),
  periodStart: IsoDate.nullable().optional(),
  periodEnd: IsoDate.nullable().optional(),
  models: z.array(z.string()).optional(),
});

export const UpdateCostCenterSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  /** Admins only: new owner (LiteLLM user id); becomes cost center admin, the previous owner stays admin. */
  ownerUserId: z.string().min(1).optional(),
  maxBudget: CostCenterBudget.nullable().optional(),
  budgetPeriod: z.enum(BUDGET_PERIODS).nullable().optional(),
  periodStart: IsoDate.nullable().optional(),
  periodEnd: IsoDate.nullable().optional(),
  /** Admins only (F-KST-15): released models; empty = all */
  models: z.array(z.string()).optional(),
  /** #15: budget per member without an individual budget, also for new members; null = unlimited */
  memberBudget: CostCenterBudget.nullable().optional(),
  memberBudgetPeriod: z.enum(KEY_BUDGET_PERIODS).nullable().optional(),
  /** #15: individual member budgets; null = back to the member budget above */
  memberBudgets: z.array(z.object({ userId: z.string().min(1), budget: CostCenterBudget.nullable() })).optional(),
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

/**
 * Member of a cost center = member of its LiteLLM team (F-KST-10). `userId` is the LiteLLM user id,
 * which is also the API-Selfservice user id once the person has signed in (E-7).
 */
export const CostCenterMemberSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  /** null until the person signs in to API-Selfservice */
  name: z.string().nullable(),
  role: z.enum(COST_CENTER_MEMBER_ROLES),
  /** `never_signed_in`: known in LiteLLM, but no API-Selfservice login yet */
  status: z.enum(['active', 'deactivated', 'never_signed_in']),
  addedBy: z.string().nullable(),
  addedAt: IsoDate,
  /** #15: individual budget; null = the cost center's member budget applies */
  budget: Money.nullable(),
  /** #15: the budget LiteLLM enforces for this member (individual, else member budget); null = unlimited */
  effectiveBudget: Money.nullable(),
  /** #15: spend on this cost center in the current member budget period */
  spendCurrentPeriod: Money,
});

export const AddCostCenterMemberSchema = z.object({
  /** LiteLLM user id, from GET /cost-centers/{id}/member-candidates */
  userId: z.string().min(1),
  role: z.enum(COST_CENTER_MEMBER_ROLES).default('user'),
});

export const UpdateCostCenterMemberSchema = z.object({ role: z.enum(COST_CENTER_MEMBER_ROLES) });

export const MemberCandidatesQuery = z.object({
  /** E-mail substring or full LiteLLM user id; at least 3 characters so the user list cannot be dumped. */
  q: z.string().trim().min(3).max(200),
});

/** A LiteLLM user that can be added to a cost center (F-KST-11: only users known to LiteLLM). */
export const MemberCandidateSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  alias: z.string().nullable(),
  hasAccount: z.boolean(),
  isMember: z.boolean(),
});

/** F-KST-16: request to join an approved cost center, decided by its cost center admins or an admin. */
export const CostCenterJoinRequestSchema = z.object({
  id: IdSchema,
  user: z.object({ id: IdSchema, name: z.string(), email: z.string() }),
  costCenter: z.object({ id: IdSchema, number: z.string(), name: z.string() }),
  message: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected']),
  reason: z.string().nullable(),
  decidedBy: IdSchema.nullable(),
  decidedAt: IsoDate.nullable(),
  createdAt: IsoDate,
});

export const CreateJoinRequestSchema = z.object({
  costCenterId: IdSchema,
  /** Optional note for the cost center admins, e.g. the project the user works on */
  message: z.string().trim().max(1000).optional(),
});

export const JoinRequestParam = z.object({ id: z.string().min(1), requestId: z.string().min(1) });

/** Max. addresses per bulk lookup and bulk add, so one request cannot walk the whole LiteLLM user list. */
export const MEMBER_BULK_MAX = 200;

/** Bulk add, step 1: resolve pasted e-mail addresses to LiteLLM users (exact, case-insensitive match). */
export const ResolveMemberEmailsSchema = z.object({
  emails: z.array(z.string().trim().max(320)).min(1).max(MEMBER_BULK_MAX),
});

export const ResolvedMemberEmailsSchema = z.object({
  /** One candidate per address that matches a LiteLLM user, in input order */
  found: z.array(MemberCandidateSchema),
  /** Valid addresses without a LiteLLM user */
  notFound: z.array(z.string()),
  /** Entries that are no e-mail address */
  invalid: z.array(z.string()),
});

/** Bulk add, step 2: add the resolved users; each one is handled like POST /cost-centers/{id}/members. */
export const BulkAddCostCenterMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(MEMBER_BULK_MAX),
  role: z.enum(COST_CENTER_MEMBER_ROLES).default('user'),
});

export const BulkAddCostCenterMembersResultSchema = z.object({
  added: z.array(CostCenterMemberSchema),
  /** Users that could not be added, with the error code (e.g. COST_CENTER_MEMBER_EXISTS, USER_DEACTIVATED) */
  failed: z.array(z.object({ userId: z.string(), code: z.string() })),
});

/** Result of POST /admin/cost-centers/resync: cost centers mirrored to LiteLLM, without a team, or failed. */
export const CostCenterResyncResultSchema = z.object({
  synced: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
});
