import { z } from 'zod';
import { ERROR_CODES } from '../errors.js';
import { LOCALES } from '../constants.js';

export const IdSchema = z.string().min(1);
export const IsoDate = z.string().datetime({ offset: true });
export const Money = z.number().min(0);
export const LocaleSchema = z.enum(LOCALES);

export const ErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
});

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
}

export const MonthQuery = z.object({
  /** YYYY-MM, defaults to current month */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const RangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const OkSchema = z.object({ ok: z.literal(true) });
