import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertPdfToMarkdown } from './lib/engine.mjs';
import fs from 'fs';

const data = new Uint8Array(fs.readFileSync('test.pdf'));
const pdf = await getDocument({ data }).promise;
const { markdown, report } = await convertPdfToMarkdown(pdf);
console.log('=== MARKDOWN ===');
console.log(markdown);
console.log('\n=== RAPOR ===');
console.log(JSON.stringify(report, null, 2));
