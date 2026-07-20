/**
 * XLSX / XLS / CSV → Markdown. SheetJS ile her çalışma sayfası
 * ayrı bir Markdown tablosuna çevrilir. Deterministiktir; AI kullanmaz.
 */

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

/**
 * @param {ArrayBuffer} arrayBuffer dosya içeriği
 * @param {object} XLSX SheetJS modülü
 * @param {string} fileName
 */
export function convertSheetToMarkdown(arrayBuffer, XLSX, fileName = '') {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: true });

  const report = {
    numPages: wb.SheetNames.length,
    pages: [],
    warnings: [],
    totalChars: 0,
    tablesDetected: 0,
    scannedPages: [],
    encodingIssues: [],
    coverage: 100,
    sourceType: 'XLSX',
  };

  const parts = [];
  wb.SheetNames.forEach((name, idx) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    // tamamen boş satırları at
    const clean = rows.filter((r) => r.some((c) => esc(c) !== ''));
    if (!clean.length) {
      report.pages.push({ page: idx + 1, chars: 0, tables: 0, sheet: name, empty: true });
      return;
    }
    const nCols = Math.max(...clean.map((r) => r.length));
    const norm = clean.map((r) => {
      const out = r.map(esc);
      while (out.length < nCols) out.push('');
      return out;
    });

    const lines = [];
    lines.push(`## ${name}`);
    lines.push('');
    lines.push('| ' + norm[0].join(' | ') + ' |');
    lines.push('|' + norm[0].map(() => ' --- ').join('|') + '|');
    for (let i = 1; i < norm.length; i++) lines.push('| ' + norm[i].join(' | ') + ' |');

    const chars = norm.flat().join('').length;
    report.totalChars += chars;
    report.tablesDetected++;
    report.pages.push({ page: idx + 1, chars, tables: 1, sheet: name, rows: norm.length });
    parts.push(lines.join('\n'));
  });

  const emptySheets = report.pages.filter((p) => p.empty).map((p) => p.sheet);
  if (emptySheets.length) {
    report.warnings.push(`Boş çalışma sayfaları atlandı: ${emptySheets.join(', ')}`);
  }
  if (!parts.length) {
    report.coverage = 0;
    report.warnings.push('Dosyada veri bulunamadı.');
  }

  const markdown = parts.join('\n\n---\n\n');
  if (/\uFFFD/.test(markdown)) report.encodingIssues.push('U+FFFD (bozuk karakter) tespit edildi');

  return { markdown, report };
}
