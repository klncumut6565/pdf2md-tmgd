# pdf2md-tmgd — PDF → Markdown Dönüştürücü

Belgeleri Claude için token-verimli Markdown'a dönüştürür. Çekirdek dönüşüm
**tamamen tarayıcıda** çalışır — dosyalar sunucuya gönderilmez. AI katmanı opsiyoneldir.

## Desteklenen formatlar

| Format | Motor | AI gerekir mi? |
|---|---|---|
| PDF | pdf.js — koordinat tabanlı (başlık/tablo/liste tespiti) | Hayır |
| DOCX | mammoth — tablo, başlık, liste yapısı korunur | Hayır |
| XLSX / XLSM / XLS / CSV | SheetJS — her çalışma sayfası ayrı tablo | Hayır |
| TXT / MD | Doğrudan | Hayır |
| PNG / JPG / WEBP | Tesseract OCR (tr+en) veya Gemini Vision | **Evet** (görüntüde metin katmanı yoktur) |

> Ekran görüntüsü ve taranmış belgelerde piksel dışında veri yoktur; OCR olmadan
> Markdown'a çevrilemez. Tesseract anahtarsız çalışır ama tablo yapısını koruyamaz;
> Gemini Vision belirgin şekilde daha doğrudur.

## Mimari

| Katman | Ne yapar | Nerede çalışır |
|---|---|---|
| PDF motoru (`lib/engine.mjs`) | Koordinat tabanlı metin/tablo çıkarma, kalite raporu | Tarayıcı |
| DOCX motoru (`lib/docx.mjs`) | HTML→MD, tablo ve başlık korumalı, içerik kaybı denetimi | Tarayıcı |
| Tablo motoru (`lib/xlsx.mjs`) | Çalışma sayfaları → Markdown tabloları | Tarayıcı |
| OCR (`lib/ocr.mjs`) | Görüntüden metin (Tesseract, tr+en) | Tarayıcı |
| AI Temizle (`/api/cleanup`) | Biçim düzeltme — Groq → Gemini fallback | Vercel |
| AI Vision (`/api/vision`) | Taranmış sayfa OCR — Gemini 2.0 Flash | Vercel |

## Kalite güvencesi

- Sayfa bazlı karakter sayımı; metin katmanı olmayan (taranmış) sayfalar işaretlenir
- Türkçe karakter / encoding bütünlük kontrolü (U+FFFD tespiti)
- AI temizliği çıktısı, orijinalin %85'inden kısaysa **reddedilir** (içerik kaybı koruması)
- Rapor "✅ Eksiksiz dönüşüm" demeden dosyayı Claude'a yüklemeyin

## Kurulum

```bash
npm install
npm run dev        # http://localhost:3000
```

## Vercel deploy

1. Repo'yu GitHub'a push edin
2. Vercel → New Project → repo'yu seçin (framework: Next.js, ayar gerekmez)
3. AI anahtarları iki yoldan verilebilir:
   - **Sol menüdeki API Anahtarları bölümü** (önerilen) — anahtar yalnızca kendi
     tarayıcınızın `localStorage`'ında saklanır, repoya veya sunucuya yazılmaz
   - **Vercel Environment Variables** — tüm kullanıcılar için ortak:
     `GROQ_API_KEY` (console.groq.com) / `GEMINI_API_KEY` (aistudio.google.com)

Anahtar tanımlı değilse deterministik dönüşüm (PDF/DOCX/XLSX/CSV/TXT) tam çalışır;
yalnızca "AI ile Temizle" ve "AI Vision" pasif kalır.

## Motor testi

```bash
node test.mjs   # PDF + DOCX + XLSX üzerinde 17 otomatik kontrol
```
