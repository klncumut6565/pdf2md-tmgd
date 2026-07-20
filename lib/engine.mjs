/**
 * pdf2md çekirdek motoru — deterministik, koordinat tabanlı dönüşüm.
 * pdfjs-dist document proxy alır; tarayıcıda ve Node'da aynı şekilde çalışır.
 */

const Y_TOL_FACTOR = 0.45;      // aynı satır toleransı (font boyutuna oranla)
const PARA_GAP_FACTOR = 1.6;    // paragraf boşluğu eşiği (satır yüksekliğine oranla)
const TABLE_GAP_FACTOR = 1.8;   // tablo sütun boşluğu eşiği (ortalama karakter genişliğine oranla)
const MIN_TABLE_COLS = 2;
const MIN_TABLE_ROWS = 2;

function isBoldFont(fontName = '') {
  return /bold|black|heavy|demi|semibold/i.test(fontName);
}

/** Sayfadaki text item'ları satırlara grupla (Y koordinatı) */
function groupIntoLines(items) {
  const glyphs = items
    .filter((it) => it.str && it.str.trim().length > 0)
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      h: it.height || Math.abs(it.transform[3]) || 10,
      font: it.fontName || '',
      bold: isBoldFont(it.fontName),
    }));

  glyphs.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const g of glyphs) {
    const tol = g.h * Y_TOL_FACTOR;
    let line = lines.length ? lines[lines.length - 1] : null;
    if (line && Math.abs(line.y - g.y) <= Math.max(tol, line.h * Y_TOL_FACTOR)) {
      line.items.push(g);
      line.h = Math.max(line.h, g.h);
    } else {
      // aynı Y'de daha önce açılmış satır var mı (sıralı geldiğimiz için sadece sona bakmak yeterli değil)
      line = lines.find((l) => Math.abs(l.y - g.y) <= Math.max(tol, l.h * Y_TOL_FACTOR));
      if (line) {
        line.items.push(g);
        line.h = Math.max(line.h, g.h);
      } else {
        lines.push({ y: g.y, h: g.h, items: [g] });
      }
    }
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** Satır item'larını sütun hücrelerine ayır (büyük X boşluklarından) */
function splitIntoCells(line) {
  const items = line.items;
  if (!items.length) return [];
  const avgCharW = items.reduce((s, i) => s + (i.str.length ? i.w / i.str.length : 4), 0) / items.length || 4;
  const gapThreshold = Math.max(avgCharW * TABLE_GAP_FACTOR, 8);

  const cells = [];
  let cur = { x: items[0].x, end: items[0].x + items[0].w, parts: [items[0].str], bold: items[0].bold, h: items[0].h };
  for (let i = 1; i < items.length; i++) {
    const it = items[i];
    const gap = it.x - cur.end;
    if (gap > gapThreshold) {
      cells.push(cur);
      cur = { x: it.x, end: it.x + it.w, parts: [it.str], bold: it.bold, h: it.h };
    } else {
      cur.parts.push(gap > avgCharW * 0.25 ? ' ' + it.str : it.str);
      cur.end = it.x + it.w;
      cur.bold = cur.bold && it.bold;
      cur.h = Math.max(cur.h, it.h);
    }
  }
  cells.push(cur);
  return cells.map((c) => ({
    x: c.x,
    end: c.end,
    text: c.parts.join('').replace(/\s+/g, ' ').trim(),
    bold: c.bold,
    h: c.h,
  }));
}

/** Ardışık çok hücreli satırların sütun X hizaları uyumlu mu? */
function columnsAlign(a, b) {
  if (Math.min(a.length, b.length) < MIN_TABLE_COLS) return false;
  const tol = 25;
  let matched = 0;
  for (const ca of a) {
    if (b.some((cb) => Math.abs(cb.x - ca.x) <= tol)) matched++;
  }
  return matched >= Math.min(a.length, b.length) - 1 && Math.abs(a.length - b.length) <= 2;
}

function escapeCell(t) {
  return t.replace(/\|/g, '\\|');
}

function detectListPrefix(text) {
  const m = text.match(/^([•▪·◦‣–\-\*]|\d{1,3}[\.\)]|[a-zçğıöşü][\.\)])\s+/i);
  return m ? m[1] : null;
}

/** 3x2 PDF dönüşüm matrisi çarpımı */
function mul(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/**
 * Sayfadaki gömülü görselleri tespit eder (konum + boyut).
 * Süsleme amaçlı çok küçük görseller (çizgi, nokta) elenir.
 */
export async function detectImagesOnPage(page, OPS) {
  const images = [];
  try {
    const ops = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      if (fn === OPS.save) {
        stack.push(ctm.slice());
      } else if (fn === OPS.restore) {
        ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.transform) {
        ctm = mul(args, ctm);
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintJpegXObject ||
        fn === OPS.paintInlineImage ||
        fn === OPS.paintImageMaskXObject
      ) {
        // Birim kare CTM ile ölçeklenir: genişlik |a|, yükseklik |d|
        const w = Math.abs(ctm[0]) || Math.abs(ctm[1]);
        const h = Math.abs(ctm[3]) || Math.abs(ctm[2]);
        if (w >= 12 && h >= 12) {
          images.push({ x: ctm[4], y: ctm[5], w: Math.round(w), h: Math.round(h) });
        }
      }
    }
  } catch {
    // operatör listesi alınamazsa görsel tespiti atlanır, metin dönüşümü etkilenmez
  }
  return images;
}

/**
 * Ana dönüşüm.
 * @param {object} pdfDocument pdfjs getDocument().promise sonucu
 * @returns {Promise<{markdown:string, report:object}>}
 */
export async function convertPdfToMarkdown(pdfDocument, opts = {}) {
  const numPages = pdfDocument.numPages;
  const pageOutputs = [];
  const report = {
    numPages,
    pages: [],
    warnings: [],
    totalChars: 0,
    tablesDetected: 0,
    scannedPages: [],
    encodingIssues: [],
  };

  report.imagesDetected = 0;
  report.imagePages = [];

  // 1. geçiş: font boyutu istatistiği (başlık eşiği) + gömülü görsel tespiti
  const allPagesLines = [];
  const allPagesImages = [];
  const sizeCounts = new Map();
  for (let p = 1; p <= numPages; p++) {
    const page = await pdfDocument.getPage(p);
    const content = await page.getTextContent();
    const lines = groupIntoLines(content.items);
    allPagesLines.push(lines);
    const imgs = opts.OPS ? await detectImagesOnPage(page, opts.OPS) : [];
    imgs.sort((a, b) => b.y - a.y);
    allPagesImages.push(imgs);
    if (imgs.length) {
      report.imagesDetected += imgs.length;
      report.imagePages.push(p);
    }
    for (const l of lines) {
      for (const it of l.items) {
        const key = Math.round(it.h * 2) / 2;
        sizeCounts.set(key, (sizeCounts.get(key) || 0) + it.str.length);
      }
    }
    if (opts.onProgress) opts.onProgress(p, numPages, 'analiz');
  }

  let bodySize = 10;
  let maxCount = 0;
  for (const [size, count] of sizeCounts) {
    if (count > maxCount) { maxCount = count; bodySize = size; }
  }
  const headingSizes = [...sizeCounts.keys()]
    .filter((s) => s >= bodySize * 1.15)
    .sort((a, b) => b - a);
  const headingLevel = (h) => {
    const idx = headingSizes.findIndex((s) => Math.abs(s - h) < 0.6);
    if (idx === -1) return 0;
    return Math.min(idx + 1, 4);
  };

  // 2. geçiş: markdown üretimi
  for (let p = 1; p <= numPages; p++) {
    const lines = allPagesLines[p - 1];
    const md = [];
    const pageChars = lines.reduce((s, l) => s + l.items.reduce((a, i) => a + i.str.length, 0), 0);

    // satırları hücrelere ayır
    const rows = lines.map((l) => ({ y: l.y, h: l.h, cells: splitIntoCells(l) }));

    // sayfanın medyan satır aralığı (paragraf kırılımı eşiği için)
    const gaps = [];
    for (let g = 1; g < rows.length; g++) {
      const d = rows[g - 1].y - rows[g].y;
      if (d > 0 && d < 60) gaps.push(d);
    }
    gaps.sort((a, b) => a - b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;

    const pageImages = allPagesImages[p - 1] || [];
    let imgIdx = 0;
    const imgMarker = (im, n) =>
      `\n> 🖼 **[GÖRSEL — sayfa ${p}, görsel ${n} · ${im.w}×${im.h}px]** — bu alandaki içerik metin değildir, dönüştürülemedi.\n`;

    let i = 0;
    let tableCountPage = 0;
    while (i < rows.length) {
      const row = rows[i];

      // bu satırın üstünde kalan görselleri sırayla yerleştir
      while (imgIdx < pageImages.length && pageImages[imgIdx].y > row.y) {
        md.push(imgMarker(pageImages[imgIdx], imgIdx + 1));
        imgIdx++;
      }
      const multi = row.cells.length >= MIN_TABLE_COLS;

      // tablo bloğu dene
      if (multi) {
        const block = [row];
        let j = i + 1;
        while (j < rows.length && rows[j].cells.length >= MIN_TABLE_COLS && columnsAlign(block[block.length - 1].cells, rows[j].cells)) {
          block.push(rows[j]);
          j++;
        }
        if (block.length >= MIN_TABLE_ROWS) {
          // sütun sayısı = maksimum
          const nCols = Math.max(...block.map((r) => r.cells.length));
          // sütun X merkezlerini ilk uzun satırdan al
          const ref = block.find((r) => r.cells.length === nCols) || block[0];
          const colX = ref.cells.map((c) => c.x);
          const tableRows = block.map((r) => {
            const out = new Array(nCols).fill('');
            for (const c of r.cells) {
              let best = 0, bestD = Infinity;
              for (let k = 0; k < nCols; k++) {
                const d = Math.abs(c.x - colX[k]);
                if (d < bestD) { bestD = d; best = k; }
              }
              out[best] = out[best] ? out[best] + ' ' + c.text : c.text;
            }
            return out;
          });
          md.push('');
          md.push('| ' + tableRows[0].map(escapeCell).join(' | ') + ' |');
          md.push('|' + tableRows[0].map(() => ' --- ').join('|') + '|');
          for (let r = 1; r < tableRows.length; r++) {
            md.push('| ' + tableRows[r].map(escapeCell).join(' | ') + ' |');
          }
          md.push('');
          tableCountPage++;
          i = j;
          continue;
        }
      }

      // normal satır / başlık / liste
      const text = row.cells.map((c) => c.text).join(' ').trim();
      if (!text) { i++; continue; }

      const maxH = Math.max(...row.cells.map((c) => c.h));
      const allBold = row.cells.every((c) => c.bold);
      const lvl = headingLevel(maxH);
      const prevGap = i > 0 ? rows[i - 1].y - row.y : 0;
      const paraBreak = prevGap > medianGap * 1.45;

      if (lvl > 0 && text.length < 120) {
        md.push('');
        md.push('#'.repeat(lvl + 1) + ' ' + text);
        md.push('');
      } else if (allBold && text.length < 90 && maxH >= bodySize) {
        md.push('');
        md.push('**' + text + '**');
        md.push('');
      } else if (detectListPrefix(text)) {
        const pfx = detectListPrefix(text);
        const body = text.slice(pfx.length).trim();
        if (/^\d/.test(pfx)) md.push(pfx.replace(')', '.') + ' ' + body);
        else md.push('- ' + body);
      } else {
        if (paraBreak && md.length && md[md.length - 1] !== '') md.push('');
        // tireyle bölünmüş kelime birleştirme
        const last = md.length ? md[md.length - 1] : '';
        if (last && last.endsWith('-') && /^[a-zçğıöşü]/.test(text)) {
          md[md.length - 1] = last.slice(0, -1) + text;
        } else if (last && last !== '' && !paraBreak && !last.startsWith('#') && !last.startsWith('|') && !last.startsWith('-')) {
          md[md.length - 1] = last + ' ' + text;
        } else {
          md.push(text);
        }
      }
      i++;
    }

    // sayfanın en altında kalan görseller
    while (imgIdx < pageImages.length) {
      md.push(imgMarker(pageImages[imgIdx], imgIdx + 1));
      imgIdx++;
    }

    report.tablesDetected += tableCountPage;
    report.totalChars += pageChars;
    const pageInfo = { page: p, chars: pageChars, tables: tableCountPage, images: pageImages.length };
    if (pageChars < 20) {
      report.scannedPages.push(p);
      pageInfo.scanned = true;
    }
    report.pages.push(pageInfo);

    pageOutputs.push(md.join('\n').replace(/\n{3,}/g, '\n\n').trim());
    if (opts.onProgress) opts.onProgress(p, numPages, 'dönüştürme');
  }

  let markdown = pageOutputs
    .map((t, idx) => (numPages > 1 ? `<!-- Sayfa ${idx + 1} -->\n${t}` : t))
    .join('\n\n---\n\n');

  // kalite kontrolleri
  if (/\uFFFD/.test(markdown)) {
    report.encodingIssues.push('U+FFFD (bozuk karakter) tespit edildi');
  }
  // Türkçe metinde ı/ğ/ş yoksa ve metin uzunsa şüpheli encoding
  if (report.totalChars > 2000 && !/[çğıöşüÇĞİÖŞÜ]/.test(markdown)) {
    report.warnings.push('Metinde hiç Türkçe karakter yok — İngilizce belge olabilir veya font eşleme sorunu vardır.');
  }
  if (report.scannedPages.length) {
    report.warnings.push(`Sayfa ${report.scannedPages.join(', ')} taranmış görünüyor (metin katmanı yok) — OCR/AI Vision gerekir.`);
  }
  if (report.imagesDetected > 0) {
    report.warnings.push(
      `${report.imagesDetected} gömülü görsel tespit edildi (sayfa ${report.imagePages.join(', ')}) ve çıktıda yer işaretiyle gösterildi. Görsel içeriği (ADR etiketi, piktogram, imza, kaşe, logo, grafik) metne dönüştürülmedi — bu bilgi gerekiyorsa "Görselleri AI ile Oku" kullanın.`
    );
  }
  report.coverage = report.scannedPages.length === 0 ? 100 : Math.round(((numPages - report.scannedPages.length) / numPages) * 100);

  return { markdown, report };
}
