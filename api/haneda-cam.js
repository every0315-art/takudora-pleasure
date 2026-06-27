// 羽田カメラAI解析
// ?n=1 → 国際線第2プール（Real04.jpg）hasVehicles判定
// ?n=2 → 国内線待機場（Real02.jpg）車列数判定

export const config = { maxDuration: 30 };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const n = req.query?.n === '2' ? 2 : 1;
  const IMG_URL = n === 2
    ? 'https://ttc.taxi-inf.jp/Real02.jpg'
    : 'https://ttc.taxi-inf.jp/Real04.jpg';

  const jstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (jstHour >= 23 || jstHour < 6) {
    return res.json(n === 2 ? { rows: 99, skipped: true } : { hasVehicles: true, skipped: true });
  }

  try {
    const imgRes = await fetch(IMG_URL, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
    const b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');

    const prompt = n === 2
      ? '羽田空港国内線タクシー待機場の監視カメラ画像です。画像中央付近にタクシーが蛇行しながら並んでいる車列があります。その車列が何列（行）ありますか？数字のみ答えてください。車がほとんどいない場合は0と答えてください。'
      : '羽田空港タクシー待機場の監視カメラ画像です。タクシーや車両が1台以上写っていますか？「yes」か「no」のみ答えてください。';
    const maxTokens = n === 2 ? 10 : 5;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: prompt },
        ]}],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!r.ok) throw new Error(`Claude API ${r.status}`);
    const text = (((await r.json()).content?.[0]?.text) || '').trim();

    if (n === 2) {
      const rows = parseInt(text, 10);
      return res.json({ rows: isNaN(rows) ? 99 : rows, raw: text });
    } else {
      const hasVehicles = text.toLowerCase().startsWith('yes');
      return res.json({ hasVehicles, raw: text });
    }
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
