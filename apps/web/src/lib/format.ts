import i18n from './i18n';
import { formatCostCenter } from '@litelite/shared';

function locale() {
  return i18n.resolvedLanguage === 'en' ? 'en-GB' : 'de-DE';
}

export function fmtMoney(value: number | null | undefined, opts?: { precise?: boolean }): string {
  if (value === null || value === undefined) return '–';
  const abs = Math.abs(value);
  const precise = opts?.precise ?? (abs > 0 && abs < 0.1);
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: precise ? 4 : 2,
  }).format(value);
}

/** Price per token (as stored) shown as EUR per 1M tokens, e.g. 0.0000025 -> "2,50 €". */
export function fmtPerMillionTokens(perToken: number | null | undefined): string {
  if (perToken === null || perToken === undefined) return '–';
  return fmtMoney(perToken * 1_000_000);
}

export function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '–';
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value);
}

export function fmtPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return '–';
  return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 1 }).format(ratio);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function fmtSeconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '–';
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ms / 1000);
}

export function fmtMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), { month: 'short', year: 'numeric' }).format(new Date(Date.UTC(y!, (m ?? 1) - 1, 1)));
}

export function fmtDay(date: string): string {
  return new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit' }).format(new Date(date));
}

export function fmtCostCenter(number: string): string {
  return formatCostCenter(number);
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/** YYYY-MM-DD -> ISO datetime at start of that day (UTC) */
export function dateToIso(date: string, endOfDay = false): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  if (endOfDay) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
