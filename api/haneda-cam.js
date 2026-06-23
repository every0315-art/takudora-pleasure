// 羽田空港 国際線第2プール（Real04.jpg）車両有無をClaude Haikuで判定

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // JST時刻で1〜7時はスキップ
  const jstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (jstHour >= 1 && jstHour < 7) {
    return res.json({ hasVehicles: true, skipped: true });
  }

  try {
    const stamp = Date.now();
    const imgRes = await fetch(`https://ttc.taxi-inf.jp/Real04.jpg?${stamp}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const imgB64 = imgBuf.toString('base64');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgB64 } },
            { type: 'text', text: '羽田空港タクシー待機場の監視カメラ画像です。タクシーや車両が1台以上写っていますか？「yes」か「no」のみ答えてください。' },
          ],
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!r.ok) throw new Error(`Claude API ${r.status}`);
    const data = await r.json();
    const text = (data.content?.[0]?.text || '').toLowerCase().trim();
    const hasVehicles = text.startsWith('yes');

    return res.json({ hasVehicles, raw: text });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
