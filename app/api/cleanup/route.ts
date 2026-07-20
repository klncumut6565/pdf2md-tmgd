import { NextResponse } from 'next/server';

export const maxDuration = 60;

const SYSTEM_PROMPT = `Sen bir Markdown temizleme asistanısın. Sana PDF'ten otomatik dönüştürülmüş Markdown verilecek.
GÖREV: Yalnızca biçimsel hataları düzelt — bölünmüş satırları birleştir, bozuk tablo hücrelerini hizala, yanlış başlık seviyelerini düzelt, tekrarlanan sayfa üstbilgi/altbilgilerini kaldır.
KESİN KURALLAR:
1. HİÇBİR içeriği silme, özetleme, yeniden yazma veya ekleme. Kelimeler birebir korunacak.
2. Türkçe karakterleri (ç, ğ, ı, ö, ş, ü, İ) asla değiştirme.
3. Sayısal değerleri (UN numaraları, miktarlar, tarihler) birebir koru.
4. Yanıtın SADECE düzeltilmiş Markdown olsun — açıklama, ön söz, kod bloğu işareti ekleme.`;

async function tryGroq(markdown: string): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: markdown },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

async function tryGemini(markdown: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: markdown }] }],
        generationConfig: { temperature: 0 },
      }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? null;
}

/** Kelime kaybı güvenlik kontrolü: AI çıktısı orijinalin %90'ından kısaysa reddet */
function safeLength(original: string, cleaned: string) {
  return cleaned.length >= original.length * 0.85;
}

export async function POST(req: Request) {
  try {
    const { markdown } = await req.json();
    if (!markdown || typeof markdown !== 'string') {
      return NextResponse.json({ error: 'markdown alanı gerekli' }, { status: 400 });
    }
    if (markdown.length > 400_000) {
      return NextResponse.json({ error: 'Belge AI temizliği için çok büyük (400K karakter sınırı)' }, { status: 413 });
    }

    const strip = (s: string) => s.replace(/^```(?:markdown|md)?\n?/, '').replace(/\n?```$/, '').trim();

    let out = await tryGroq(markdown);
    if (out && safeLength(markdown, strip(out))) {
      return NextResponse.json({ markdown: strip(out), engine: 'Groq / Llama 3.3 70B' });
    }
    out = await tryGemini(markdown);
    if (out && safeLength(markdown, strip(out))) {
      return NextResponse.json({ markdown: strip(out), engine: 'Gemini 2.0 Flash' });
    }
    return NextResponse.json(
      { error: 'AI motorları yanıt vermedi veya çıktı içerik kaybı riski taşıyor (API anahtarlarını kontrol edin: GROQ_API_KEY / GEMINI_API_KEY)' },
      { status: 502 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
