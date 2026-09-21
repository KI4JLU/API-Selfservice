import { describe, expect, it } from 'vitest';
import { LOCALES, NOTIFICATION_TYPES } from '@litelite/shared';
import { renderMail } from './templates.js';

/** Superset of all variables used by any template. */
const allVars = {
  appUrl: 'http://localhost:5173',
  userName: 'Erika Muster',
  userEmail: 'erika@example.org',
  number: '12345678',
  name: 'Institut X',
  ownerName: 'Prof. Y',
  ownerEmail: 'y@example.org',
  reason: 'Nicht plausibel',
  spend: '8.50',
  budget: '10.00',
  percent: 85,
  keyName: 'my-key',
  expiresAt: '2026-12-31',
  detail: ' (2)',
  deletedAt: '2025-01-01',
  role: 'admin',
  periodStart: '2026-01-01',
  periodEnd: '2026-01-31',
  rowCount: 12,
  total: '123.45',
};

describe('renderMail', () => {
  for (const type of NOTIFICATION_TYPES) {
    for (const locale of LOCALES) {
      it(`${type} renders in ${locale} without leftover placeholders`, () => {
        const { subject, text } = renderMail(type, locale, allVars);
        expect(subject.length).toBeGreaterThan(0);
        expect(text.length).toBeGreaterThan(0);
        expect(subject).not.toMatch(/\{\{|\}\}/);
        expect(text).not.toMatch(/\{\{|\}\}/);
      });
    }
  }

  it('formats 8-digit cost center numbers as "1234 5678"', () => {
    const { subject, text } = renderMail('cost_center_request_approved', 'de', allVars);
    expect(subject).toContain('1234 5678');
    expect(text).toContain('1234 5678');
    expect(text).not.toContain('12345678');
  });

  it('leaves non-8-digit numbers untouched', () => {
    const { subject } = renderMail('cost_center_request_approved', 'en', { ...allVars, number: '1234' });
    expect(subject).toContain('1234');
  });

  it('renders missing variables as empty strings (no placeholder leaks)', () => {
    const { subject, text } = renderMail('user_budget_80', 'en', {});
    expect(subject).toBe('Budget  % used');
    expect(text).not.toMatch(/\{\{/);
  });

  it('de and en differ and include the app url', () => {
    const de = renderMail('key_expired', 'de', allVars);
    const en = renderMail('key_expired', 'en', allVars);
    expect(de.subject).not.toBe(en.subject);
    expect(de.text).toContain(`${allVars.appUrl}/keys`);
    expect(en.text).toContain(`${allVars.appUrl}/keys`);
    expect(de.subject).toContain('my-key');
  });
});
