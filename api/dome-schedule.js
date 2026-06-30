const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchDomeSchedule(anthropicKey) {
  const res = await fetch('https://www.tokyo-dome.co.jp/dome/event/schedule.html', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // script/style除去してテキスト抽出
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 8000);

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `以下は東京ドームのイベントスケジュールページのテキストです。
今後2ヶ月以内のイベント一覧をJSONで返してください。
形式: [{"date":"YYYY-MM-DD","name":"イベント名","open":"HH:MM","start":"HH:MM","end":"HH:MM頃","demand":"high|max|medium|low"}]
野球（巨人主催試合）はdemand:medium、大規模コンサートはhigh〜max、その他はmedium。
endは開始から2〜3時間後を目安に推定。JSONのみ返すこと。

${text}`,
      }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}`);
  const data = await r.json();
  const raw = (data.content?.[0]?.text || '').trim();
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('parse failed');
  return JSON.parse(m[0]);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=10800, stale-while-revalidate=600');

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const events = await fetchDomeSchedule(anthropicKey);
    return res.json({ events, updatedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
