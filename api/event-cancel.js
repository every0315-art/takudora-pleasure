// イベント中止チェックAPI
// ?items=イベント名:月:日,イベント名:月:日,...
// → cancelled: ["イベント名:月:日", ...] で個別日程の中止を返す

export const config = { maxDuration: 30 };

const CACHE_SEC = 1800;

async function checkCancelled(name, month, day) {
  const q = encodeURIComponent(`${name} 中止`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return false;
    const xml = await r.text();

    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);

    for (const item of items) {
      const pubDate = item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
      if (pubDate && new Date(pubDate).getTime() < cutoff) continue;

      const title = item.match(/<title>([^<]*)<\/title>/)?.[1] || '';
      const desc  = item.match(/<description>([^<]*)<\/description>/)?.[1] || '';
      const text  = (title + ' ' + desc).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,'');

      if (!/中止|延期|雨天中止|台風|中断/.test(text)) continue;

      // 記事内に特定日付（X月Y日）の言及があるか確認
      const dateMentions = [...text.matchAll(/(\d{1,2})月(\d{1,2})日/g)].map(m => ({
        m: parseInt(m[1]), d: parseInt(m[2]),
      }));

      if (dateMentions.length === 0) {
        // 日付指定なし → 全体中止 → この日も対象
        console.log(`[event-cancel] general: ${name} → "${title.slice(0,60)}"`);
        return true;
      }

      // 日付指定あり → 対象日が含まれる場合のみ中止
      if (dateMentions.some(dt => dt.m === month && dt.d === day)) {
        console.log(`[event-cancel] date-specific: ${name} ${month}/${day} → "${title.slice(0,60)}"`);
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

  // items=名前:月:日,名前:月:日,...
  const rawItems = (req.query.items || '').split(',').map(s => s.trim()).filter(Boolean);
  if (rawItems.length === 0) return res.json({ cancelled: [] });

  const targets = rawItems.slice(0, 15).map(s => {
    const parts = s.split(':');
    const day   = parseInt(parts.pop());
    const month = parseInt(parts.pop());
    const name  = parts.join(':').trim();
    return { key: s, name, month, day };
  }).filter(t => t.name && t.month && t.day);

  const results = await Promise.allSettled(targets.map(t => checkCancelled(t.name, t.month, t.day)));

  const cancelled = targets
    .filter((_, i) => results[i].status === 'fulfilled' && results[i].value === true)
    .map(t => t.key);

  return res.json({ cancelled, checkedAt: new Date().toISOString() });
}
