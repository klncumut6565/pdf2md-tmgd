'use client';

import { useCallback, useRef, useState } from 'react';
import { convertPdfToMarkdown } from '../lib/engine.mjs';

type Report = {
  numPages: number;
  pages: { page: number; chars: number; tables: number; scanned?: boolean }[];
  warnings: string[];
  totalChars: number;
  tablesDetected: number;
  scannedPages: number[];
  encodingIssues: string[];
  coverage: number;
};

// Türkçe metin için yaklaşık Claude token tahmini
const estTokens = (chars: number) => Math.ceil(chars / 3.2);

export default function Home() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string>('');
  const [report, setReport] = useState<Report | null>(null);
  const [pdfBytes, setPdfBytes] = useState<number>(0);
  const [status, setStatus] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [over, setOver] = useState(false);
  const pdfDocRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setStatus('Sadece PDF dosyası kabul edilir.');
      return;
    }
    setBusy(true);
    setMarkdown('');
    setReport(null);
    setFileName(file.name);
    setPdfBytes(file.size);
    setStatus('PDF okunuyor…');
    setProgress(5);
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjs.getDocument({ data }).promise;
      pdfDocRef.current = pdf;
      const result = await convertPdfToMarkdown(pdf, {
        onProgress: (p: number, n: number, phase: string) => {
          const base = phase === 'analiz' ? 0 : 50;
          setProgress(10 + base * 0.8 + (p / n) * 40);
          setStatus(`Sayfa ${p}/${n} — ${phase}`);
        },
      });
      setMarkdown(result.markdown);
      setReport(result.report as Report);
      setProgress(100);
      setStatus('Dönüşüm tamamlandı.');
    } catch (e: any) {
      setStatus('HATA: ' + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }, []);

  const download = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (fileName || 'belge').replace(/\.pdf$/i, '') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyMd = async () => {
    await navigator.clipboard.writeText(markdown);
    setStatus('Panoya kopyalandı.');
  };

  const aiCleanup = async () => {
    setAiBusy(true);
    setStatus('AI ile temizleniyor…');
    try {
      const res = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI servisi yanıt vermedi');
      setMarkdown(data.markdown);
      setStatus(`AI temizliği tamamlandı (${data.engine}).`);
    } catch (e: any) {
      setStatus('AI HATASI: ' + e.message + ' — deterministik çıktı korunuyor.');
    } finally {
      setAiBusy(false);
    }
  };

  const aiVision = async () => {
    if (!report?.scannedPages.length || !pdfDocRef.current) return;
    setAiBusy(true);
    try {
      let md = markdown;
      for (const pNum of report.scannedPages) {
        setStatus(`Sayfa ${pNum} AI Vision ile okunuyor…`);
        const page = await pdfDocRef.current.getPage(pNum);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const imageB64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageB64 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Vision servisi hatası');
        md = md.replace(`<!-- Sayfa ${pNum} -->\n`, `<!-- Sayfa ${pNum} (AI Vision) -->\n${data.markdown}\n`);
      }
      setMarkdown(md);
      setStatus('Taranmış sayfalar AI Vision ile tamamlandı.');
    } catch (e: any) {
      setStatus('VISION HATASI: ' + e.message);
    } finally {
      setAiBusy(false);
    }
  };

  const pdfTok = estTokens(pdfBytes * 0.75); // PDF binary → Claude'a yüklendiğinde yaklaşık maliyet
  const mdTok = estTokens(markdown.length);
  const savingPct = pdfTok > 0 ? Math.max(0, Math.round((1 - mdTok / pdfTok) * 100)) : 0;

  return (
    <main className="wrap">
      <div className="plate">
        PDF <span className="div" /> MD
      </div>
      <p className="sub">
        PDF belgelerini Claude için token-verimli Markdown&apos;a dönüştürür. Dönüşüm tamamen
        tarayıcınızda çalışır — dosya hiçbir sunucuya gönderilmez. Kalite raporu ✅ %100
        göstermeden dosyayı kullanmayın.
      </p>

      <div
        className={'drop' + (over ? ' over' : '')}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <strong>PDF dosyasını buraya bırakın</strong>
        <p>veya tıklayarak seçin — dosya cihazınızdan çıkmaz</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
      </div>

      {busy && <div className="progress"><div className="p" style={{ width: `${progress}%` }} /></div>}
      {status && <div className="status">{fileName && <span className="fname">{fileName}</span>} {status}</div>}

      {report && (
        <div className="grid">
          <div>
            <div className="card">
              <h3>Kalite Kontrol Raporu</h3>
              <div className="qrow"><span className="k">Metin kapsama</span>
                <span className={'v ' + (report.coverage === 100 ? 'ok' : 'err')}>%{report.coverage}</span></div>
              <div className="qrow"><span className="k">Sayfa</span>
                <span className="v">{report.numPages}</span></div>
              <div className="qrow"><span className="k">Karakter</span>
                <span className="v">{report.totalChars.toLocaleString('tr-TR')}</span></div>
              <div className="qrow"><span className="k">Tablo</span>
                <span className="v">{report.tablesDetected}</span></div>
              <div className="qrow"><span className="k">Encoding</span>
                <span className={'v ' + (report.encodingIssues.length ? 'err' : 'ok')}>
                  {report.encodingIssues.length ? 'SORUNLU' : 'TEMİZ'}</span></div>
              <div className="qrow"><span className="k">Taranmış sayfa</span>
                <span className={'v ' + (report.scannedPages.length ? 'warn' : 'ok')}>
                  {report.scannedPages.length || 'YOK'}</span></div>

              {report.warnings.length === 0 && report.encodingIssues.length === 0 ? (
                <div className="okbox">✅ Eksiksiz dönüşüm — Claude&apos;a yüklemeye hazır.</div>
              ) : (
                <div className="warnbox">
                  {[...report.encodingIssues, ...report.warnings].map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h3>Token Karşılaştırma</h3>
              <div className="tokbar">
                <div className="lbl"><span>PDF (doğrudan)</span><span>~{pdfTok.toLocaleString('tr-TR')} tok</span></div>
                <div className="bar"><div className="fill" style={{ width: '100%', background: 'var(--err)' }} /></div>
                <div className="lbl" style={{ marginTop: 10 }}><span>MD (bu araç)</span><span>~{mdTok.toLocaleString('tr-TR')} tok</span></div>
                <div className="bar"><div className="fill" style={{ width: `${pdfTok ? Math.min(100, (mdTok / pdfTok) * 100) : 0}%`, background: 'var(--ok)' }} /></div>
              </div>
              <div className="saving">%{savingPct} tasarruf</div>
            </div>
          </div>

          <div className="card">
            <h3>Markdown Önizleme</h3>
            <div className="preview">{markdown || '(boş)'}</div>
            <div className="actions">
              <button className="btn primary" onClick={download} disabled={!markdown}>.md İNDİR</button>
              <button className="btn ghost" onClick={copyMd} disabled={!markdown}>KOPYALA</button>
              <button className="btn ghost" onClick={aiCleanup} disabled={!markdown || aiBusy}>
                {aiBusy ? 'AI ÇALIŞIYOR…' : 'AI İLE TEMİZLE'}
              </button>
              {report.scannedPages.length > 0 && (
                <button className="btn ghost" onClick={aiVision} disabled={aiBusy}>
                  TARANMIŞ SAYFALARI AI VISION İLE OKU ({report.scannedPages.length})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
