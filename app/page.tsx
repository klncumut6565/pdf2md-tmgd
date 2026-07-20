'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { convertPdfToMarkdown } from '../lib/engine.mjs';
import { convertDocxToMarkdown } from '../lib/docx.mjs';
import { convertSheetToMarkdown } from '../lib/xlsx.mjs';
import { convertImageWithOcr, fileToBase64 } from '../lib/ocr.mjs';

type Report = {
  numPages: number;
  pages: any[];
  warnings: string[];
  totalChars: number;
  tablesDetected: number;
  scannedPages: number[];
  encodingIssues: string[];
  coverage: number;
  sourceType?: string;
  ocrConfidence?: number;
};

type Kind = 'pdf' | 'docx' | 'sheet' | 'image' | 'text';

type Item = {
  name: string;
  size: number;
  kind: Kind;
  status: 'bekliyor' | 'işleniyor' | 'tamam' | 'hata';
  markdown: string;
  report: Report | null;
  error?: string;
  file?: File;
};

const estTokens = (chars: number) => Math.ceil(chars / 3.2);

function detectKind(name: string): Kind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (/\.(xlsx|xlsm|xls|csv)$/.test(n)) return 'sheet';
  if (/\.(png|jpg|jpeg|webp|bmp)$/.test(n)) return 'image';
  if (/\.(txt|md)$/.test(n)) return 'text';
  return null;
}

const KIND_LABEL: Record<Kind, string> = {
  pdf: 'PDF', docx: 'DOCX', sheet: 'TABLO', image: 'GÖRÜNTÜ', text: 'METİN',
};

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<number>(-1);
  const [status, setStatus] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [over, setOver] = useState(false);

  // API anahtarları — yalnızca tarayıcıda saklanır
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  const pdfDocsRef = useRef<Record<number, any>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setGeminiKey(localStorage.getItem('pdf2md_gemini') || '');
      setGroqKey(localStorage.getItem('pdf2md_groq') || '');
    } catch {}
  }, []);

  const saveKeys = () => {
    try {
      localStorage.setItem('pdf2md_gemini', geminiKey.trim());
      localStorage.setItem('pdf2md_groq', groqKey.trim());
      setKeySaved(true);
      setTimeout(() => setKeySaved(false), 2200);
    } catch {
      setStatus('Anahtarlar kaydedilemedi (tarayıcı depolaması kapalı).');
    }
  };

  const clearKeys = () => {
    try {
      localStorage.removeItem('pdf2md_gemini');
      localStorage.removeItem('pdf2md_groq');
    } catch {}
    setGeminiKey(''); setGroqKey('');
    setStatus('Anahtarlar silindi.');
  };

  const patch = (idx: number, p: Partial<Item>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...p } : it)));

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const all = Array.from(fileList);
    const files = all.filter((f) => detectKind(f.name));
    const rejected = all.filter((f) => !detectKind(f.name));
    if (rejected.length) setStatus(`Desteklenmeyen dosya atlandı: ${rejected.map((f) => f.name).join(', ')}`);
    if (!files.length) return;

    const startIdx = items.length;
    setItems((prev) => [...prev, ...files.map((f) => ({
      name: f.name, size: f.size, kind: detectKind(f.name)!, status: 'bekliyor' as const,
      markdown: '', report: null, file: f,
    }))]);
    setBusy(true);

    for (let k = 0; k < files.length; k++) {
      const idx = startIdx + k;
      const file = files[k];
      const kind = detectKind(file.name)!;
      patch(idx, { status: 'işleniyor' });
      setSel(idx);
      setStatus(`${file.name} işleniyor (${k + 1}/${files.length})…`);
      try {
        let result: { markdown: string; report: Report };

        if (kind === 'pdf') {
          const pdfjs = await import('pdfjs-dist');
          pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
          const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
          pdfDocsRef.current[idx] = pdf;
          result = await convertPdfToMarkdown(pdf, {
            onProgress: (p: number, n: number) => setProgress(((k + p / n / 2) / files.length) * 100),
          });
          result.report.sourceType = 'PDF';
        } else if (kind === 'docx') {
          const mammoth = await import('mammoth');
          result = await convertDocxToMarkdown(await file.arrayBuffer(), (mammoth as any).default || mammoth);
        } else if (kind === 'sheet') {
          const XLSX = await import('xlsx');
          result = convertSheetToMarkdown(await file.arrayBuffer(), XLSX, file.name);
        } else if (kind === 'image') {
          setStatus(`${file.name} — OCR çalışıyor (ilk çalıştırmada dil verisi indirilir)…`);
          const Tesseract = await import('tesseract.js');
          result = await convertImageWithOcr(file, Tesseract, (p: number) =>
            setProgress(((k + p) / files.length) * 100)
          );
        } else {
          const txt = await file.text();
          result = {
            markdown: txt.trim(),
            report: {
              numPages: 1, pages: [{ page: 1, chars: txt.length, tables: 0 }], warnings: [],
              totalChars: txt.length, tablesDetected: 0, scannedPages: [], encodingIssues: [],
              coverage: 100, sourceType: 'METİN',
            },
          };
        }
        patch(idx, { status: 'tamam', markdown: result.markdown, report: result.report });
      } catch (e: any) {
        patch(idx, { status: 'hata', error: e?.message || String(e) });
      }
      setProgress(((k + 1) / files.length) * 100);
    }
    setStatus(`${files.length} dosya işlendi.`);
    setBusy(false);
  }, [items.length]);

  const downloadOne = (it: Item) => {
    const blob = new Blob([it.markdown], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = it.name.replace(/\.[^.]+$/, '') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadAll = () =>
    items.filter((it) => it.status === 'tamam').forEach((it, i) => setTimeout(() => downloadOne(it), i * 300));

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
        body: JSON.stringify({ markdown: items[sel].markdown, groqKey: groqKey.trim(), geminiKey: geminiKey.trim() }),
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

  const visionCall = async (imageB64: string) => {
    const res = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageB64, geminiKey: geminiKey.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Vision servisi hatası');
    return data.markdown as string;
  };

  const aiVision = async () => {
    const it = sel >= 0 ? items[sel] : null;
    if (!it) return;
    setAiBusy(true);
    try {
      if (it.kind === 'image' && it.file) {
        setStatus('Görüntü AI Vision ile okunuyor…');
        const b64 = await fileToBase64(it.file);
        const md = await visionCall(b64);
        patch(sel, {
          markdown: md,
          report: it.report ? { ...it.report, coverage: 100, warnings: ['AI Vision çıktısıdır — kritik verileri (UN no, miktar, tarih) gözle doğrulayın.'], sourceType: 'GÖRÜNTÜ (AI Vision)' } : it.report,
        });
        setStatus('AI Vision tamamlandı.');
      } else if (it.report?.scannedPages.length && pdfDocsRef.current[sel]) {
        let md = it.markdown;
        for (const pNum of it.report.scannedPages) {
          setStatus(`Sayfa ${pNum} AI Vision ile okunuyor…`);
          const page = await pdfDocsRef.current[sel].getPage(pNum);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width; canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          const out = await visionCall(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
          md = md.replace(`<!-- Sayfa ${pNum} -->\n`, `<!-- Sayfa ${pNum} (AI Vision) -->\n${out}\n`);
        }
        patch(sel, { markdown: md });
        setStatus('Taranmış sayfalar AI Vision ile tamamlandı.');
      }
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
  const canVision = !!cur && (cur.kind === 'image' || !!cur.report?.scannedPages.length);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="plate">PDF <span className="div" /> MD</div>

        <div className="side-sec">
          <h4>API Anahtarları</h4>
          <p className="hint">
            Yalnızca bu tarayıcıda saklanır, sunucuya kaydedilmez. AI özellikleri
            için gereklidir; metin tabanlı belgelerde gerekmez.
          </p>

          <label className="lbl">GEMINI_API_KEY <span className="tag">Vision + temizleme</span></label>
          <input
            className="keyinput"
            type={showKeys ? 'text' : 'password'}
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder="AIza..."
            spellCheck={false}
          />

          <label className="lbl">GROQ_API_KEY <span className="tag">hızlı temizleme</span></label>
          <input
            className="keyinput"
            type={showKeys ? 'text' : 'password'}
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder="gsk_..."
            spellCheck={false}
          />

          <label className="check">
            <input type="checkbox" checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} />
            Anahtarları göster
          </label>

          <div className="actions">
            <button className="btn primary sm" onClick={saveKeys}>{keySaved ? 'KAYDEDİLDİ ✓' : 'KAYDET'}</button>
            <button className="btn ghost sm" onClick={clearKeys}>SİL</button>
          </div>

          <div className="keystate">
            <div><span className={geminiKey ? 'dot on' : 'dot'} /> Gemini {geminiKey ? 'tanımlı' : 'tanımsız'}</div>
            <div><span className={groqKey ? 'dot on' : 'dot'} /> Groq {groqKey ? 'tanımlı' : 'tanımsız'}</div>
          </div>
          <p className="hint">
            Ücretsiz anahtar: aistudio.google.com (Gemini) · console.groq.com (Groq)
          </p>
        </div>

        <div className="side-sec">
          <h4>Desteklenen Formatlar</h4>
          <ul className="fmt">
            <li><b>PDF</b> — koordinat tabanlı, AI gerekmez</li>
            <li><b>DOCX</b> — tablo/başlık korunur, AI gerekmez</li>
            <li><b>XLSX / XLS / CSV</b> — her sayfa tablo, AI gerekmez</li>
            <li><b>TXT / MD</b> — doğrudan</li>
            <li><b>PNG / JPG</b> — OCR gerekir (aşağıya bakın)</li>
          </ul>
          <p className="hint">
            Ekran görüntüsü ve taranmış belgelerde metin katmanı yoktur; bu nedenle
            OCR şarttır. Anahtarsız Tesseract OCR çalışır (düşük doğruluk, tablo bozulur),
            Gemini anahtarı varsa <b>AI Vision</b> ile çok daha doğru sonuç alınır.
          </p>
        </div>
      </aside>

      <main className="content">
        <p className="sub">
          Belgeleri Claude için token-verimli Markdown&apos;a dönüştürür. Dönüşüm tamamen
          tarayıcınızda çalışır — dosyalar sunucuya gönderilmez (AI özellikleri hariç).
          Kalite raporu ✅ göstermeden çıktıyı kullanmayın.
        </p>

        <div
          className={'drop' + (over ? ' over' : '')}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files); }}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        >
          <strong>Dosyaları buraya bırakın</strong>
          <p>PDF · DOCX · XLSX · CSV · TXT · PNG/JPG — tek veya çoklu seçim</p>
          <input
            ref={inputRef} type="file" multiple hidden
            accept=".pdf,.docx,.xlsx,.xlsm,.xls,.csv,.txt,.md,.png,.jpg,.jpeg,.webp,.bmp"
            onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {busy && <div className="progress"><div className="p" style={{ width: `${progress}%` }} /></div>}
        {status && <div className="status">{status}</div>}

        {items.length > 0 && (
          <div className="card" style={{ marginTop: 18 }}>
            <h3>Dosya Kuyruğu ({doneCount}/{items.length})</h3>
            {items.map((it, i) => (
              <div key={i} className="qrow filerow" style={{ background: i === sel ? 'var(--panel-2)' : 'transparent' }} onClick={() => setSel(i)}>
                <span className="k fname" style={{ color: i === sel ? 'var(--adr-orange)' : undefined }}>
                  <span className="kindtag">{KIND_LABEL[it.kind]}</span> {it.name}
                </span>
                <span className={'v ' + (it.status === 'tamam' ? (it.report && it.report.coverage === 100 && !it.report.warnings.length ? 'ok' : 'warn') : it.status === 'hata' ? 'err' : '')}>
                  {it.status === 'tamam' ? (it.report ? `%${it.report.coverage}` : '✓') : it.status.toUpperCase()}
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

        {cur && cur.status === 'hata' && <div className="warnbox" style={{ marginTop: 18 }}>⚠ {cur.name}: {cur.error}</div>}

        {report && cur && (
          <div className="grid">
            <div>
              <div className="card">
                <h3>Kalite Kontrol Raporu</h3>
                <div className="qrow"><span className="k">Kaynak tipi</span><span className="v">{report.sourceType || '—'}</span></div>
                <div className="qrow"><span className="k">{cur.kind === 'image' ? 'OCR güveni' : 'Metin kapsama'}</span>
                  <span className={'v ' + (report.coverage >= 95 ? 'ok' : report.coverage >= 70 ? 'warn' : 'err')}>%{report.coverage}</span></div>
                <div className="qrow"><span className="k">{cur.kind === 'sheet' ? 'Çalışma sayfası' : 'Sayfa'}</span><span className="v">{report.numPages}</span></div>
                <div className="qrow"><span className="k">Karakter</span><span className="v">{report.totalChars.toLocaleString('tr-TR')}</span></div>
                <div className="qrow"><span className="k">Tablo</span><span className="v">{report.tablesDetected}</span></div>
                <div className="qrow"><span className="k">Encoding</span>
                  <span className={'v ' + (report.encodingIssues.length ? 'err' : 'ok')}>{report.encodingIssues.length ? 'SORUNLU' : 'TEMİZ'}</span></div>

                {report.warnings.length === 0 && report.encodingIssues.length === 0 ? (
                  <div className="okbox">✅ Eksiksiz dönüşüm — Claude&apos;a yüklemeye hazır.</div>
                ) : (
                  <div className="warnbox">
                    {[...report.encodingIssues, ...report.warnings].map((w, i) => <div key={i} style={{ marginBottom: 6 }}>⚠ {w}</div>)}
                  </div>
                )}
              </div>

              <div className="card" style={{ marginTop: 18 }}>
                <h3>Token Karşılaştırma</h3>
                <div className="tokbar">
                  <div className="lbl"><span>Kaynak (doğrudan)</span><span>~{pdfTok.toLocaleString('tr-TR')} tok</span></div>
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
                {canVision && (
                  <button className="btn ghost" onClick={aiVision} disabled={aiBusy}>
                    AI VISION İLE OKU{cur.kind !== 'image' ? ` (${report.scannedPages.length} sayfa)` : ''}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
