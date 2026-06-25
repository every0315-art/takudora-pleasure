// 年間大規模イベントAPI
// Notionデータベースからイベントを取得 → 公式サイトで日程確認 → 返却
// Vercel CDN 24時間キャッシュ、毎朝cronで更新

export const config = { maxDuration: 55 };

const NOTION_DB_ID = '6b71dc84-d080-834b-9c6a-01c3f476fd3a';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 千葉・首都圏のみで東京都外は除外
const EXCLUDE_VENUE_KEYWORDS = ['幕張', '千葉', 'さいたま', '横浜'];

// app.html で独自カードを持つ会場（同名カード経由で表示されるため別扱い）
const DEDICATED_VENUE_CARDS = ['東京ビッグサイト', '国立競技場', '東京ドーム', '代々木第一体育館', '両国国技館'];

async function fetchNotionEvents(notionToken) {
  const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 100 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Notion API ${res.status}`);
  const data = await res.json();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return data.results.map(page => {
    const p = page.properties;
    const name = p['イベント名']?.title?.[0]?.text?.content || '';
    const start = p['開催日2026']?.date?.start || null;
    const end   = p['開催日2026']?.date?.end   || start;
    const venue = p['会場・エリア']?.rich_text?.[0]?.text?.content || '';
    const genre = p['ジャンル']?.select?.name || '';
    const memo  = p['規模・メモ']?.rich_text?.[0]?.text?.content  || '';
    const url   = p['公式サイト']?.url || null;

    if (!name || !start) return null;
    if (end && new Date(end) < today) return null;

    // 東京都外は除外
    if (EXCLUDE_VENUE_KEYWORDS.some(kw => venue.includes(kw))) return null;

    // 需要レベル推定
    let demand = 'medium';
    if (genre === '音楽フェス') demand = 'high';
    if (memo.includes('数十万人') || name.includes('コミックマーケット')) demand = 'max';
    if (genre === 'スポーツ') demand = 'low';
    if (genre === '伝統行事' || genre === '市・縁日') demand = 'medium';

    // 伝統的な固定日程（伝統祭礼・縁日は毎年同日）
    const fixed = genre === '伝統祭礼' || genre === '市・縁日' || genre === '伝統行事';

    // 専用会場カードを持つイベントかどうか
    const venueCard = DEDICATED_VENUE_CARDS.find(vc => venue.includes(vc)) || null;

    return { name, notionStart: start, notionEnd: end || start, venue, url, demand, fixed, venueCard, genre };
  }).filter(Boolean);
}

async function fetchPageText(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(10000),
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const title    = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const metaDesc = (html.match(/<meta[^>]*description[^>]*content="([^"]+)"/i) || [])[1] || '';
  const jsonLd   = (html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n').slice(0, 3000);
  const body     = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 5000);
  return `TITLE:${title}\nMETA:${metaDesc}\nJSON-LD:${jsonLd}\nBODY:${body}`;
}

async function extractDateWithClaude(name, text, anthropicKey) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{ role: 'user', content: `「${name}」の2026年開催日程をこのページから抽出。JSONのみ: {"found":true,"start":"YYYY-MM-DD","end":"YYYY-MM-DD"} または {"found":false}\n\n${text}` }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}`);
  const data = await r.json();
  const raw = (data.content?.[0]?.text || '').trim();
  const m = raw.match(/\{[^}]+\}/);
  return m ? JSON.parse(m[0]) : null;
}

async function verifyEvent(ev, anthropicKey) {
  // 固定日程 or 公式URLなし → 確認不要
  if (ev.fixed || !ev.url) return { ...ev, verified: ev.fixed };
  try {
    const text   = await fetchPageText(ev.url);
    const result = await extractDateWithClaude(ev.name, text, anthropicKey);
    if (result?.found && result.start) {
      return { ...ev, start: result.start, end: result.end || result.start, verified: true, verifiedAt: new Date().toISOString() };
    }
    return { ...ev, verified: false, verifiedAt: new Date().toISOString() };
  } catch {
    return { ...ev, verified: false };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');

  const notionToken  = process.env.NOTION_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!notionToken)  return res.status(500).json({ error: 'NOTION_TOKEN not configured' });
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  let events;
  try {
    events = await fetchNotionEvents(notionToken);
  } catch (e) {
    return res.status(502).json({ error: `Notion fetch failed: ${e.message}` });
  }

  const results = await Promise.allSettled(events.map(ev => verifyEvent(ev, anthropicKey)));
  const verified = results.map((r, i) => r.status === 'fulfilled' ? r.value : { ...events[i], verified: false });

  return res.json({ events: verified, updatedAt: new Date().toISOString(), total: verified.length });
}
