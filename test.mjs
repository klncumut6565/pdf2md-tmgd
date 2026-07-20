/**
 * Motor regresyon testi — `node test.mjs`
 * Motorda değişiklik yaptıktan sonra çalıştırın; tüm kontroller ✅ olmalı.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertPdfToMarkdown } from './lib/engine.mjs';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { convertDocxToMarkdown } from './lib/docx.mjs';
import { convertSheetToMarkdown } from './lib/xlsx.mjs';
import fs from 'fs';

const ab = (f) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

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

// --- DOCX ---
const dx = await convertDocxToMarkdown(ab('test.docx'), mammoth);
checks.push(
  ['DOCX: başlık hiyerarşisi', dx.markdown.startsWith('# TEHLİKELİ MADDE FAALİYET RAPORU')],
  ['DOCX: tablo hücreleri', dx.markdown.includes('| 1006 | ARGON, SIKIŞTIRILMIŞ | 2 | 450 |')],
  ['DOCX: madde listesi', dx.markdown.includes('- Turuncu plakalar okunaklı değil')],
  ['DOCX: kapsama %100', dx.report.coverage === 100],
);

// --- XLSX ---
const xs = convertSheetToMarkdown(ab('test.xlsx'), XLSX);
checks.push(
  ['XLSX: sayfa başlığı', xs.markdown.includes('## Sefer Listesi')],
  ['XLSX: satır verisi', xs.markdown.includes('| 05.01.2026 | 34ABC123 | Ahmet Yılmaz | 1203 | 8.500 |')],
  ['XLSX: ikinci sayfa', xs.markdown.includes('## Muafiyet')],
  ['XLSX: 2 tablo', xs.report.tablesDetected === 2],
);

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
