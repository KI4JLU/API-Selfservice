import { z } from 'zod';
import { SAP_RECIPIENT_TYPES } from '../constants.js';
import { IdSchema, IsoDate, Money } from './common.js';

/** #14: 8 digits; a cost center starts with 1 or 2, a project with 6 or 8. */
export const SapRecipientSchema = z
  .object({ type: z.enum(SAP_RECIPIENT_TYPES), number: z.string().regex(/^\d{8}$/, 'SAP number must have 8 digits') })
  .refine((r) => (r.type === 'cost_center' ? /^[12]/ : /^[68]/).test(r.number), {
    message: 'A cost center starts with 1 or 2, a project with 6 or 8',
    path: ['number'],
  });

/** HRZ sender cost center ("KoSt alt") */
export const SapSenderCostCenter = z.string().regex(/^\d{8}$/, 'Sender cost center must have 8 digits');

export const SapExportSettingsSchema = z.object({ senderCostCenter: SapSenderCostCenter.nullable() });
export const UpdateSapExportSettingsSchema = z.object({ senderCostCenter: SapSenderCostCenter });

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SapExportRequestSchema = z.object({
  /** billing month YYYY-MM */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /** default: last day of the month */
  documentDate: Day.optional(),
  postingDate: Day.optional(),
  /** posting text; `{Provider}` is replaced by the provider name. No leading = + - @: spreadsheets would read a formula. */
  text: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .refine((v) => !/^[=+\-@]/.test(v), 'The posting text must not start with = + - @')
    .optional(),
});

export const SapExportRowSchema = z.object({
  /** TTMMJJJJ */
  documentDate: z.string(),
  postingDate: z.string(),
  senderCostCenter: z.string(),
  /** KoSt_neu; null when the recipient is a project */
  recipientCostCenter: z.string().nullable(),
  /** Auftrag_neu; null when the recipient is a cost center */
  recipientOrder: z.string().nullable(),
  text: z.string(),
  /** euros, rounded to cents */
  amount: Money,
  provider: z.string(),
  /** portal cost centers behind this row */
  costCenters: z.array(z.object({ id: IdSchema, number: z.string(), name: z.string() })),
});

export const SapExportPreviewSchema = z.object({
  month: z.string(),
  documentDate: Day,
  postingDate: Day,
  senderCostCenter: z.string().nullable(),
  text: z.string(),
  rows: z.array(SapExportRowSchema),
  total: Money,
  /** cost centers with spend in the month but no SAP recipient; not exported */
  missingRecipient: z.array(z.object({ id: IdSchema, number: z.string(), name: z.string(), spend: Money })),
  /** spend without an (existing) portal cost center in the month; not exported */
  unassignedSpend: Money,
});

export const SapExportSchema = z.object({
  id: IdSchema,
  month: z.string(),
  documentDate: Day,
  postingDate: Day,
  senderCostCenter: z.string(),
  rowCount: z.number().int(),
  total: Money,
  createdAt: IsoDate,
  createdBy: z.object({ id: IdSchema, name: z.string() }).nullable(),
});
