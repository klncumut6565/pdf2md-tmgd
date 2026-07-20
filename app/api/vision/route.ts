import { NextResponse } from 'next/server';

export const maxDuration = 60;

const VISION_PROMPT = `Bu görüntü, taranmış bir PDF sayfasıdır (muhtemelen Türkçe, tehlikeli madde taşımacılığı / resmi belge içeriği).
GÖREV: Sayfadaki TÜM metni eksiksiz oku ve Markdown formatında yaz.
KURALLAR:
1. Tabloları Markdown tablo sözdizimiyle yaz.
2. Başlıkları # işaretleriyle hiyerarşik yaz.
3. Türkçe karakterleri doğru kullan (ç, ğ, ı, ö, ş, ü, İ).
4. Hiçbir metni atlama, özetleme veya yorumlama.
5. Okunamayan kısımlar için [OKUNAMADI] yaz.
6. Yanıtın SADECE Markdown olsun — açıklama ekleme.`;

export async function POST(req: Request) {
  try {
    const { imageB64 } = await req.json();
    if (!imageB64) return NextResponse.json({ error: 'imageB64 alanı gerekli' }, { status: 400 });

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return NextResponse.json({ error: 'GEMINI_API_KEY tanımlı değil (Vercel → Settings → Environment Variables)' }, { status: 500 });
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: VISION_PROMPT },
                { inlineData: { mimeType: 'image/jpeg', data: imageB64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      }
    );
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ error: `Gemini hatası: ${t.slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json();
    const md = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    const clean = md.replace(/^```(?:markdown|md)?\n?/, '').replace(/\n?```$/, '').trim();
    return NextResponse.json({ markdown: clean });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
