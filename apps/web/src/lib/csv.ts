/** Semicolon-separated CSV as Excel in German locales expects it; fields with separators, quotes or line breaks are quoted. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

/** Saves CSV text as a file; the BOM lets Excel read umlauts as UTF-8. */
export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
