/**
 * DOCX → Markdown. mammoth ile semantik HTML üretilir, ardından
 * tablo/başlık/liste yapısı korunarak Markdown'a çevrilir.
 * Deterministiktir; AI kullanmaz.
 */

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

/** Satır içi biçimlendirmeyi koruyarak etiketleri temizle */
function inline(html) {
  let s = html
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\s*(strong|b)\s*>/gi, '**')
    .replace(/<\s*\/\s*(strong|b)\s*>/gi, '**')
    .replace(/<\s*(em|i)\s*>/gi, '*')
    .replace(/<\s*\/\s*(em|i)\s*>/gi, '*')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, txt) => {
      const t = txt.replace(/<[^>]+>/g, '').trim();
      return href && t ? `[${t}](${href})` : t;
    })
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s).replace(/\s+/g, ' ').trim();
  // boş vurgu işaretlerini temizle
  return s.replace(/\*\*\s*\*\*/g, '').replace(/(?<!\*)\*\s*\*(?!\*)/g, '');
}

function cellText(html) {
  return inline(html).replace(/\|/g, '\\|');
}

function tableToMarkdown(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1]))
  );
  if (!rows.length) return { md: '', rows: 0 };
  const nCols = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => {
    const out = r.slice();
    while (out.length < nCols) out.push('');
    return out;
  });
  const lines = [];
  lines.push('| ' + norm[0].join(' | ') + ' |');
  lines.push('|' + norm[0].map(() => ' --- ').join('|') + '|');
  for (let i = 1; i < norm.length; i++) lines.push('| ' + norm[i].join(' | ') + ' |');
  return { md: '\n' + lines.join('\n') + '\n', rows: norm.length };
}

/**
 * @param {ArrayBuffer} arrayBuffer .docx dosya içeriği
 * @param {object} mammoth mammoth modülü
 */
export async function convertDocxToMarkdown(arrayBuffer, mammoth) {
  // mammoth Node'da `buffer`, tarayıcıda `arrayBuffer` bekler
  const input =
    typeof Buffer !== 'undefined' && typeof window === 'undefined'
      ? { buffer: Buffer.from(arrayBuffer) }
      : { arrayBuffer };

  // NOT: mammoth styleMap'te stil adı TEK tırnak ile yazılmalıdır.
  const styleMap = [
    "p[style-name='Title'] => h1:fresh",
    "p[style-name='Başlık'] => h1:fresh",
    "p[style-name='Subtitle'] => h2:fresh",
    "p[style-name='Alt Başlık'] => h2:fresh",
    "p[style-name='Heading 1'] => h2:fresh",
    "p[style-name='Başlık 1'] => h2:fresh",
    "p[style-name='Heading 2'] => h3:fresh",
    "p[style-name='Başlık 2'] => h3:fresh",
    "p[style-name='Heading 3'] => h4:fresh",
    "p[style-name='Başlık 3'] => h4:fresh",
    "p[style-name='Heading 4'] => h5:fresh",
    "p[style-name='Başlık 4'] => h5:fresh",
  ];

  const { value: html, messages } = await mammoth.convertToHtml(input, { styleMap });

  const report = {
    numPages: 1,
    pages: [],
    warnings: [],
    totalChars: 0,
    tablesDetected: 0,
    scannedPages: [],
    encodingIssues: [],
    coverage: 100,
    sourceType: 'DOCX',
  };

  const out = [];
  // Blok elemanları sırayla işle
  const blockRe = /<(h[1-6]|p|table|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  let consumed = 0;
  while ((m = blockRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const innerRaw = m[2];
    consumed += m[0].length;

    if (tag === 'table') {
      const t = tableToMarkdown(m[0]);
      if (t.md) { out.push(t.md); report.tablesDetected++; }
    } else if (/^h[1-6]$/.test(tag)) {
      const txt = inline(innerRaw);
      if (txt) out.push('\n' + '#'.repeat(Number(tag[1])) + ' ' + txt + '\n');
    } else if (tag === 'ul' || tag === 'ol') {
      const lis = [...innerRaw.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
      lis.forEach((li, i) => {
        const txt = inline(li[1]);
        if (txt) out.push(tag === 'ol' ? `${i + 1}. ${txt}` : `- ${txt}`);
      });
      out.push('');
    } else {
      const txt = inline(innerRaw);
      if (txt) out.push(txt + '\n');
    }
  }

  let markdown = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // İçerik doğrulama: HTML'deki düz metin ile Markdown'daki metni karşılaştır
  const plainFromHtml = decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const plainFromMd = markdown.replace(/[|#*\-\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  report.totalChars = plainFromMd.length;

  if (plainFromHtml.length > 0) {
    const ratio = plainFromMd.length / plainFromHtml.length;
    if (ratio < 0.9) {
      report.coverage = Math.max(0, Math.round(ratio * 100));
      report.warnings.push(
        `Belgedeki metnin yaklaşık %${Math.round((1 - ratio) * 100)} kadarı çıktıya aktarılamamış olabilir (metin kutusu, dipnot veya gömülü nesne içeriği).`
      );
    }
  }

  if (/\uFFFD/.test(markdown)) report.encodingIssues.push('U+FFFD (bozuk karakter) tespit edildi');
  if (!markdown.trim()) {
    report.coverage = 0;
    report.warnings.push('Belgeden metin çıkarılamadı — içerik görsel/gömülü nesne olabilir.');
  }
  const imgCount = (html.match(/<img/gi) || []).length;
  if (imgCount > 0) {
    report.warnings.push(`${imgCount} adet gömülü görsel atlandı (görsel içindeki metin çıkarılmaz).`);
  }
  for (const msg of messages || []) {
    if (msg.type === 'warning' && /unrecognised|unsupported/i.test(msg.message)) continue;
  }

  report.pages.push({ page: 1, chars: report.totalChars, tables: report.tablesDetected });
  return { markdown, report };
}
