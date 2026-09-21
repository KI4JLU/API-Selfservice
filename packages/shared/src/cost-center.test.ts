import { describe, expect, it } from 'vitest';
import { formatCostCenter, normalizeCostCenter } from './cost-center.js';
import { currentPeriod, monthPeriod } from './period.js';

describe('cost center', () => {
  it('normalizes with spaces', () => {
    expect(normalizeCostCenter('1111 1111')).toBe('11111111');
    expect(normalizeCostCenter('  1234  5678 ')).toBe('12345678');
  });
  it('rejects invalid', () => {
    expect(normalizeCostCenter('1234')).toBeNull();
    expect(normalizeCostCenter('1234567a')).toBeNull();
    expect(normalizeCostCenter('123456789')).toBeNull();
  });
  it('formats', () => {
    expect(formatCostCenter('11111111')).toBe('1111 1111');
  });
});

describe('period', () => {
  it('monthly', () => {
    const p = currentPeriod('monthly', new Date('2026-09-19T10:00:00Z'));
    expect(p.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('yearly', () => {
    const p = currentPeriod('yearly', new Date('2026-09-19T10:00:00Z'));
    expect(p.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('project', () => {
    const s = new Date('2026-01-01T00:00:00Z');
    const e = new Date('2026-12-31T00:00:00Z');
    const p = currentPeriod('project', new Date(), s, e);
    expect(p.start).toBe(s);
    expect(p.end).toBe(e);
  });
  it('monthPeriod', () => {
    const p = monthPeriod('2026-02');
    expect(p.end.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});
