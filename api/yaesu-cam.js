// 八重洲待機所・乗場（p-counter）車両有無をClaude Haikuで判定
// 2枚の画像をサーバー側で取得して並列判定

export const config = { maxDuration: 30 };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const IMGS = [
  'https://svc01.p-counter.jp/doc-server-taxi/tokyo_taxi/data/park.jpg',  // 待機所
  'https://svc01.p-counter.jp/doc-server-taxi/tokyo_taxi/data/cam_a.jpg', // 乗場
];

async function fetchB64(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`image fetch ${r.status}`);
  const buf = await r.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

async function checkImage(b64, apiKey) {
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
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: '八重洲タクシー乗り場・待機所の監視カメラ画像です。タクシーや車両が1台以上写っていますか？「yes」か「no」のみ答えてください。' },
        ],
      }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Claude API ${r.status}`);
  const data = await r.json();
  const text = (data.content?.[0]?.text || '').toLowerCase().trim();
  return text.startsWith('yes');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // JST 1〜6時はスキップ
  const jstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (jstHour >= 1 && jstHour < 6) {
    return res.json({ hasVehicles: true, skipped: true });
  }

  try {
    const [b64a, b64b] = await Promise.all(IMGS.map(fetchB64));
    const [hasA, hasB] = await Promise.all([checkImage(b64a, apiKey), checkImage(b64b, apiKey)]);
    const hasVehicles = hasA && hasB;
    console.log(`[yaesu-cam] park=${hasA} boarding=${hasB} → hasVehicles=${hasVehicles}`);
    return res.json({ hasVehicles, park: hasA, boarding: hasB });
  } catch (e) {
    console.error(`[yaesu-cam] error: ${e.message}`);
    return res.status(502).json({ error: e.message });
  }
}
