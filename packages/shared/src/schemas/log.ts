import { z } from 'zod';
import { IdSchema, IsoDate, Money } from './common.js';

export const RequestLogSchema = z.object({
  requestId: z.string(),
  sessionId: z.string().nullable(),
  time: IsoDate,
  type: z.string(),
  status: z.enum(['success', 'failure']),
  model: z.string(),
  keyId: IdSchema.nullable(),
  keyName: z.string().nullable(),
  cost: Money,
  durationMs: z.number().nullable(),
  ttftMs: z.number().nullable(),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  tags: z.array(z.string()),
  error: z.string().nullable(),
});

export const LogsQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  model: z.string().optional(),
  keyId: IdSchema.optional(),
  status: z.enum(['success', 'failure']).optional(),
  requestId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
