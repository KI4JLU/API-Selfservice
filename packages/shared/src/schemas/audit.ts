import { z } from 'zod';
import { AUDIT_ENTITIES, AUDIT_SEVERITIES, COST_CENTER_EVENT_CATEGORIES } from '../constants.js';
import { IdSchema, IsoDate } from './common.js';

/** One row of the admin event log (audit_log). */
export const AuditEventSchema = z.object({
  id: IdSchema,
  createdAt: IsoDate,
  severity: z.enum(AUDIT_SEVERITIES),
  /** Dotted `<entity>.<verb>`, e.g. `key.create`, `budget.block`, `job.failed`. */
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  /** Human-readable name of the entity (user e-mail, key name, cost center number), if it still exists. */
  entityLabel: z.string().nullable(),
  /** Null for system events (jobs, budget checks). */
  actor: z.object({ id: IdSchema, name: z.string(), email: z.string() }).nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
});

export const AuditEventsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  severity: z.enum(AUDIT_SEVERITIES).optional(),
  entity: z.enum(AUDIT_ENTITIES).optional(),
  entityId: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  /** Substring match on the action, e.g. `budget` or `key.create`. */
  action: z.string().min(1).max(100).optional(),
  /** ISO datetime lower bound (inclusive). */
  from: IsoDate.optional(),
  /** ISO datetime upper bound (exclusive). */
  to: IsoDate.optional(),
});

/** #13: event of one cost center for its cost center admins (members, requests, keys, budget, limits). */
export const CostCenterEventSchema = AuditEventSchema.extend({
  category: z.enum(COST_CENTER_EVENT_CATEGORIES),
  /** The person the event is about (member, requester, key owner), if any. */
  subject: z.object({ id: IdSchema, name: z.string(), email: z.string() }).nullable(),
});

export const CostCenterEventsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  category: z.enum(COST_CENTER_EVENT_CATEGORIES).optional(),
  /** only warnings and errors */
  warningsOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** person or key name, case-insensitive */
  q: z.string().trim().max(100).optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});

export const CostCenterEventsSchema = z.object({
  items: z.array(CostCenterEventSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** events per category and warnings in the filtered range, for the filter chips */
  counts: z.object({
    all: z.number().int(),
    warnings: z.number().int(),
    limits: z.number().int(),
    requests: z.number().int(),
    membership: z.number().int(),
    keys: z.number().int(),
    budget: z.number().int(),
  }),
});
