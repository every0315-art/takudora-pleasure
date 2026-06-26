// イベント中止チェックAPI
// 今日・明日のイベント名でGoogle News RSSを検索し「中止」記事があれば返す

export const config = { maxDuration: 30 };

// キャッシュは30分（中止情報は速報性が重要）
const CACHE_SEC = 1800;

async function checkCancelled(name) {
  // Google News RSS で「{name} 中止」を検索
  const q = encodeURIComponent(`${name} 中止`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return false;
    const xml = await r.text();

    // 直近48時間以内の記事のみ対象
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);

    for (const item of items) {
      const pubDate = item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
      if (pubDate && new Date(pubDate).getTime() < cutoff) continue;

      const title = item.match(/<title>([^<]*)<\/title>/)?.[1] || '';
      const desc  = item.match(/<description>([^<]*)<\/description>/)?.[1] || '';
      const text  = (title + ' ' + desc).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,'');

      // 「中止」「延期」「雨天」が含まれ、かつイベント名が含まれる
      if (/中止|延期|雨天中止|台風|中断/.test(text)) {
        console.log(`[event-cancel] detected: ${name} → "${title.slice(0,60)}"`);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `public, s-maxage=${CACHE_SEC}, stale-while-revalidate=300`);

  // クエリパラメータでイベント名リストを受け取る（カンマ区切り）
  const names = (req.query.names || '').split(',').map(s => s.trim()).filter(Boolean);
  if (names.length === 0) return res.json({ cancelled: [] });

  // 最大10件まで並列チェック
  const targets = names.slice(0, 10);
  const results = await Promise.allSettled(targets.map(n => checkCancelled(n)));

  const cancelled = targets.filter((_, i) =>
    results[i].status === 'fulfilled' && results[i].value === true
  );

  return res.json({ cancelled, checkedAt: new Date().toISOString() });
}
