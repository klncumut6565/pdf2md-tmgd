/**
 * Görüntü (PNG/JPG/WEBP) → Markdown, Tesseract.js ile TARAYICI İÇİNDE OCR.
 * AI GEREKTİRMEZ, ancak doğruluğu AI Vision'dan belirgin düşüktür:
 * tablo yapısı korunmaz, düzen bozulabilir. Çıktı daima "doğrulama gerekir"
 * olarak işaretlenir.
 */

export async function convertImageWithOcr(file, Tesseract, onProgress) {
  const worker = await Tesseract.createWorker(['tur', 'eng'], 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
    },
  });

  const { data } = await worker.recognize(file);
  await worker.terminate();

  const words = data.words || [];
  const meanConf = words.length
    ? words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length
    : data.confidence || 0;

  // Satırları koru, boş satırları paragraf ayracına çevir
  const markdown = (data.text || '')
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const report = {
    numPages: 1,
    pages: [{ page: 1, chars: markdown.length, tables: 0 }],
    warnings: [],
    totalChars: markdown.length,
    tablesDetected: 0,
    scannedPages: markdown.length < 20 ? [1] : [],
    encodingIssues: [],
    coverage: markdown.length < 20 ? 0 : Math.round(meanConf),
    sourceType: 'GÖRÜNTÜ (OCR)',
    ocrConfidence: Math.round(meanConf),
  };

  report.warnings.push(
    `OCR çıktısıdır (güven: %${Math.round(meanConf)}). Tablo yapısı korunmaz ve karakter hatası olabilir — Claude'a yüklemeden önce içeriği mutlaka doğrulayın. Daha yüksek doğruluk için "AI Vision ile Oku" kullanın.`
  );
  if (meanConf < 75) {
    report.warnings.push('OCR güven düzeyi düşük — görüntü çözünürlüğü yetersiz olabilir. AI Vision önerilir.');
  }
  if (markdown.length < 20) {
    report.warnings.push('Görüntüden metin çıkarılamadı.');
  }

  return { markdown, report };
}

/** Görüntü dosyasını base64'e çevir (AI Vision için) */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Dosya okunamadı'));
    r.readAsDataURL(file);
  });
}
