/**
 * Motor regresyon testi — `node test.mjs`
 * Motorda değişiklik yaptıktan sonra çalıştırın; tüm kontroller ✅ olmalı.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertPdfToMarkdown } from './lib/engine.mjs';
import fs from 'fs';

const data = new Uint8Array(fs.readFileSync('test.pdf'));
const pdf = await getDocument({ data }).promise;
const { markdown, report } = await convertPdfToMarkdown(pdf);

const checks = [
  ['Türkçe başlık korunmuş', markdown.includes('TEHLİKELİ MADDE TAŞIMA KONTROL FORMU')],
  ['Başlık hiyerarşisi (##)', /^##\s/m.test(markdown)],
  ['Tablo tespit edildi', report.tablesDetected >= 1],
  ['Tablo satırı: UN 3082 hücreleri', markdown.includes('| 3082 | ÇEVRE İÇİN TEHLİKELİ MADDE, SIVI | 9 | III | 1.250 |')],
  ['Tablo satırı: UN 1203', markdown.includes('| 1203 | BENZİN | 3 | II | 5.000 |')],
  ['Paragraf birleştirme (bölünmemiş)', markdown.includes('SRC-5 belgesi ve araç uygunluk belgesi')],
  ['Kapsama %100', report.coverage === 100],
  ['Encoding temiz', report.encodingIssues.length === 0],
  ['Uyarı yok', report.warnings.length === 0],
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '✅' : '❌') + ' ' + name);
  if (!ok) fail++;
}
if (fail) {
  console.log('\n--- ÜRETİLEN MARKDOWN ---\n' + markdown);
  console.error(`\n${fail} kontrol BAŞARISIZ`);
  process.exit(1);
}
console.log('\nTüm kontroller geçti — motor sağlam.');
