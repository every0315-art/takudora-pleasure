// 羽田空港 国内線待機場（Real02.jpg）車列数をClaude Haikuで判定
// サーバー側で画像取得 → base64変換 → Claude Haiku判定
// 除外時間: JST 23:00〜6:00

export const config = { maxDuration: 30 };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const IMG_URL = 'https://ttc.taxi-inf.jp/Real02.jpg';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // JST 23〜6時はスキップ
  const jstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (jstHour >= 23 || jstHour < 6) {
    return res.json({ rows: 99, skipped: true });
  }

  try {
    const imgRes = await fetch(IMG_URL, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!imgRes.ok) throw new Error(`image fetch ${imgRes.status}`);
    const buf = await imgRes.arrayBuffer();
    const b64 = Buffer.from(buf).toString('base64');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: '羽田空港国内線タクシー待機場の監視カメラ画像です。画像中央付近にタクシーが蛇行しながら並んでいる車列があります。その車列が何列（行）ありますか？数字のみ答えてください。車がほとんどいない場合は0と答えてください。' },
          ],
        }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!r.ok) throw new Error(`Claude API ${r.status}`);
    const data = await r.json();
    const text = (data.content?.[0]?.text || '').trim();
    const rows = parseInt(text, 10);
    const rowCount = isNaN(rows) ? 99 : rows;
    console.log(`[haneda-cam2] result: "${text}" → rows=${rowCount}`);

    return res.json({ rows: rowCount, raw: text });
  } catch (e) {
    console.error(`[haneda-cam2] error: ${e.message}`);
    return res.status(502).json({ error: e.message });
  }
}
