import { z } from 'zod';
import { AUDIT_ENTITIES, AUDIT_SEVERITIES } from '../constants.js';
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
