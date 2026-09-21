import { z } from 'zod';
import { NOTIFICATION_TYPES } from '../constants.js';
import { IdSchema, IsoDate } from './common.js';

export const NotificationSchema = z.object({
  id: IdSchema,
  userId: IdSchema.nullable(),
  type: z.enum(NOTIFICATION_TYPES),
  recipient: z.string(),
  locale: z.string(),
  subject: z.string(),
  status: z.enum(['sent', 'failed', 'skipped']),
  error: z.string().nullable(),
  sentAt: IsoDate,
});

export const NotificationsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  type: z.enum(NOTIFICATION_TYPES).optional(),
  status: z.enum(['sent', 'failed', 'skipped']).optional(),
});
