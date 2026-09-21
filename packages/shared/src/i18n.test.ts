import { describe, expect, it } from 'vitest';
import { de, en } from './i18n/index.js';
import { ERROR_CODES } from './errors.js';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n', () => {
  it('de and en have identical key sets', () => {
    expect(keys(de).sort()).toEqual(keys(en).sort());
  });
  it('every error code has a translation', () => {
    for (const code of ERROR_CODES) {
      expect((de.errors as Record<string, string>)[code]).toBeTruthy();
      expect((en.errors as Record<string, string>)[code]).toBeTruthy();
    }
  });
});
