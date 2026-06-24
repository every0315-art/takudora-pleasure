// 羽田空港 国内線待機場（Real02.jpg）車列数をClaude Haikuで判定
// クライアントから base64 画像をPOSTで受け取り判定する
// 除外時間: JST 23:00〜6:00

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // JST 23〜6時はスキップ
  const jstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (jstHour >= 23 || jstHour < 6) {
    return res.json({ rows: 99, skipped: true });
  }

  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image required' });

  try {
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
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: '羽田空港国内線タクシー待機場の監視カメラ画像です。画像中央付近にタクシーが蛇行しながら並んでいる車列があります。その車列が何列（行）ありますか？数字のみ答えてください。車がほとんどいない場合は0と答えてください。' },
          ],
        }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`Claude API ${r.status}: ${errText.slice(0, 200)}`);
    }
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
