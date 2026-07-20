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

type Item = {
  name: string;
  size: number;
  status: 'bekliyor' | 'işleniyor' | 'tamam' | 'hata';
  markdown: string;
  report: Report | null;
  error?: string;
};

// Türkçe metin için yaklaşık Claude token tahmini
const estTokens = (chars: number) => Math.ceil(chars / 3.2);

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<number>(-1);
  const [status, setStatus] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [over, setOver] = useState(false);
  const pdfDocsRef = useRef<Record<number, any>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (idx: number, p: Partial<Item>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...p } : it)));

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) { setStatus('Sadece PDF dosyaları kabul edilir.'); return; }

    const startIdx = items.length;
    const newItems: Item[] = files.map((f) => ({
      name: f.name, size: f.size, status: 'bekliyor', markdown: '', report: null,
    }));
    setItems((prev) => [...prev, ...newItems]);
    setBusy(true);

    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

    // Sıralı işleme: her dosya tam kapasiteyle, bellek şişmeden
    for (let k = 0; k < files.length; k++) {
      const idx = startIdx + k;
      patch(idx, { status: 'işleniyor' });
      setSel(idx);
      setStatus(`${files[k].name} işleniyor (${k + 1}/${files.length})…`);
      try {
        const data = new Uint8Array(await files[k].arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        pdfDocsRef.current[idx] = pdf;
        const result = await convertPdfToMarkdown(pdf, {
          onProgress: (p: number, n: number) => setProgress(((k + p / n / 2) / files.length) * 100),
        });
        patch(idx, { status: 'tamam', markdown: result.markdown, report: result.report as Report });
      } catch (e: any) {
        patch(idx, { status: 'hata', error: e?.message || String(e) });
      }
    }
    setProgress(100);
    setStatus(`${files.length} dosya işlendi.`);
    setBusy(false);
  }, [items.length]);

  const downloadOne = (it: Item) => {
    const blob = new Blob([it.markdown], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = it.name.replace(/\.pdf$/i, '') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadAll = () => {
    items.filter((it) => it.status === 'tamam').forEach((it, i) =>
      setTimeout(() => downloadOne(it), i * 300)
    );
  };

  const copyMd = async () => {
    if (sel < 0) return;
    await navigator.clipboard.writeText(items[sel].markdown);
    setStatus('Panoya kopyalandı.');
  };

  const aiCleanup = async () => {
    if (sel < 0) return;
    setAiBusy(true);
    setStatus('AI ile temizleniyor…');
    try {
      const res = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: items[sel].markdown }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI servisi yanıt vermedi');
      patch(sel, { markdown: data.markdown });
      setStatus(`AI temizliği tamamlandı (${data.engine}).`);
    } catch (e: any) {
      setStatus('AI HATASI: ' + e.message + ' — deterministik çıktı korunuyor.');
    } finally {
      setAiBusy(false);
    }
  };

  const aiVision = async () => {
    const it = sel >= 0 ? items[sel] : null;
    const pdfDoc = pdfDocsRef.current[sel];
    if (!it?.report?.scannedPages.length || !pdfDoc) return;
    setAiBusy(true);
    try {
      let md = it.markdown;
      for (const pNum of it.report.scannedPages) {
        setStatus(`Sayfa ${pNum} AI Vision ile okunuyor…`);
        const page = await pdfDoc.getPage(pNum);
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
      patch(sel, { markdown: md });
      setStatus('Taranmış sayfalar AI Vision ile tamamlandı.');
    } catch (e: any) {
      setStatus('VISION HATASI: ' + e.message);
    } finally {
      setAiBusy(false);
    }
  };

  const cur = sel >= 0 ? items[sel] : null;
  const report = cur?.report ?? null;
  const pdfTok = cur ? estTokens(cur.size * 0.75) : 0;
  const mdTok = cur ? estTokens(cur.markdown.length) : 0;
  const savingPct = pdfTok > 0 ? Math.max(0, Math.round((1 - mdTok / pdfTok) * 100)) : 0;
  const doneCount = items.filter((i) => i.status === 'tamam').length;

  return (
    <main className="wrap">
      <div className="plate">
        PDF <span className="div" /> MD
      </div>
      <p className="sub">
        PDF belgelerini Claude için token-verimli Markdown&apos;a dönüştürür. Dönüşüm tamamen
        tarayıcınızda çalışır — dosyalar hiçbir sunucuya gönderilmez. Kalite raporu ✅ %100
        göstermeden dosyayı kullanmayın.
      </p>

      <div
        className={'drop' + (over ? ' over' : '')}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <strong>PDF dosyalarını buraya bırakın</strong>
        <p>tek veya çoklu seçim — dosyalar cihazınızdan çıkmaz</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {busy && <div className="progress"><div className="p" style={{ width: `${progress}%` }} /></div>}
      {status && <div className="status">{status}</div>}

      {items.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3>Dosya Kuyruğu ({doneCount}/{items.length})</h3>
          {items.map((it, i) => (
            <div
              key={i}
              className="qrow"
              style={{ cursor: 'pointer', background: i === sel ? 'var(--panel-2)' : 'transparent', borderRadius: 6, padding: '7px 8px' }}
              onClick={() => setSel(i)}
            >
              <span className="k fname" style={{ color: i === sel ? 'var(--adr-orange)' : undefined }}>{it.name}</span>
              <span className={'v ' + (it.status === 'tamam' ? (it.report && it.report.coverage === 100 && !it.report.encodingIssues.length ? 'ok' : 'warn') : it.status === 'hata' ? 'err' : '')}>
                {it.status === 'tamam'
                  ? (it.report ? `%${it.report.coverage}` : '✓')
                  : it.status.toUpperCase()}
              </span>
            </div>
          ))}
          {doneCount > 1 && (
            <div className="actions">
              <button className="btn primary" onClick={downloadAll}>TÜMÜNÜ İNDİR ({doneCount} .md)</button>
            </div>
          )}
        </div>
      )}

      {cur && cur.status === 'hata' && (
        <div className="warnbox" style={{ marginTop: 18 }}>⚠ {cur.name}: {cur.error}</div>
      )}

      {report && cur && (
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
            <h3>Markdown Önizleme — {cur.name}</h3>
            <div className="preview">{cur.markdown || '(boş)'}</div>
            <div className="actions">
              <button className="btn primary" onClick={() => downloadOne(cur)} disabled={!cur.markdown}>.md İNDİR</button>
              <button className="btn ghost" onClick={copyMd} disabled={!cur.markdown}>KOPYALA</button>
              <button className="btn ghost" onClick={aiCleanup} disabled={!cur.markdown || aiBusy}>
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
