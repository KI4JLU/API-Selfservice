import type { BudgetPeriod } from './constants.js';

export interface Period {
  start: Date;
  end: Date; // exclusive
}

/** Returns the current budget period for a given period type at `now`. */
export function currentPeriod(period: BudgetPeriod, now: Date, projectStart?: Date | null, projectEnd?: Date | null): Period {
  if (period === 'monthly') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
  }
  if (period === 'yearly') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    return { start, end };
  }
  return {
    start: projectStart ?? new Date(0),
    end: projectEnd ?? new Date(Date.UTC(9999, 0, 1)),
  };
}

export function monthPeriod(month: string): Period {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
