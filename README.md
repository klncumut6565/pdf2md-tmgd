# pdf2md-tmgd — PDF → Markdown Dönüştürücü

PDF belgelerini Claude için token-verimli Markdown'a dönüştürür. Çekirdek dönüşüm
**tamamen tarayıcıda** çalışır (pdf.js, koordinat tabanlı deterministik motor) —
dosya hiçbir sunucuya gönderilmez. AI katmanı opsiyoneldir.

## Mimari

| Katman | Ne yapar | Nerede çalışır |
|---|---|---|
| Deterministik motor (`lib/engine.mjs`) | Metin çıkarma, başlık/tablo/liste tespiti, kalite raporu | Tarayıcı |
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
3. Environment Variables (opsiyonel, AI özellikleri için):
   - `GROQ_API_KEY` — https://console.groq.com (ücretsiz)
   - `GEMINI_API_KEY` — https://aistudio.google.com (ücretsiz)

AI anahtarları tanımlı değilse deterministik dönüşüm tam çalışır; sadece
"AI ile Temizle" ve "AI Vision" butonları hata mesajı döner.

## Motor testi

```bash
node test.mjs   # test.pdf üzerinde dönüşüm + kalite raporu
```
