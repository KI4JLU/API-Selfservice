import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('separates with ; and writes decimal commas', () => {
    expect(toCsv([['a', 1.5, null]])).toBe('a;1,5;\r\n');
  });

  it('quotes separators, quotes and line breaks', () => {
    expect(toCsv([['x;y', 'say "hi"', 'a\nb']])).toBe('"x;y";"say ""hi""";"a\nb"\r\n');
  });

  it('neutralises formulas (CSV injection)', () => {
    expect(toCsv([['=HYPERLINK("http://evil")', '+1', '-2', '@SUM(A1)', 'ok']])).toBe(`"'=HYPERLINK(""http://evil"")";'+1;'-2;'@SUM(A1);ok\r\n`);
    // negative numbers stay numbers
    expect(toCsv([[-2]])).toBe('-2\r\n');
  });
});
