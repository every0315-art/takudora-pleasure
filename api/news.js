function parseRSS(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const s = m[1];
    const title = (s.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/) || s.match(/<title>([\s\S]*?)<\/title>/))?.[1]?.trim() || '';
    const link  = s.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
    const pub   = s.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
    const src   = (s.match(/<source[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/) || s.match(/<source[^>]*>([\s\S]*?)<\/source>/))?.[1]?.trim() || '';
    if (title) items.push({ title, link, pub, source: src });
  }
  return items;
}

async function googleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/xml' }
  });
  return parseRSS(await res.text());
}

async function tokyoTCNews() {
  const res = await fetch('https://www.tokyo-tc.or.jp/news/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'ja',
    }
  });
  const html = await res.text();
  // <ul class="news-list"> セクションのみ抽出
  const listM = html.match(/<ul class="news-list">([\s\S]*?)<\/ul>/);
  if (!listM) return [];
  const items = [];
  for (const m of listM[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const block = m[1];
    const dateM = block.match(/<time>(\d{4})\.(\d{2})\.(\d{2})<\/time>/);
    const linkM = block.match(/<a[^>]+class="news-title"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!dateM || !linkM) continue;
    const pub = `${dateM[1]}-${dateM[2]}-${dateM[3]}`;
    const url = linkM[1].startsWith('http') ? linkM[1] : `https://www.tokyo-tc.or.jp${linkM[1]}`;
    const title = linkM[2].replace(/<[^>]+>/g, '').trim();
    if (!title) continue;
    items.push({ title, link: url, pub, source: '東京タクシーセンター' });
  }
  return items.slice(0, 10);
}

async function taxiAssocNews() {
  const res = await fetch('https://www.taxi-tokyo.or.jp/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'ja',
    }
  });
  const html = await res.text();
  // 全 ul.home-info__list を結合して li を抽出
  const lists = [...html.matchAll(/<ul class="home-info__list">([\s\S]*?)<\/ul>/g)].map(m => m[1]).join('');
  const items = [];
  for (const m of lists.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const block = m[1];
    // コメントアウト行を除外
    if (block.includes('<!--')) continue;
    const dateM = block.match(/<span class="home-info__list__date">(\d{4})\.(\d+)\.(\d+)<\/span>/);
    const txtM  = block.match(/<span class="home-info__list__txt">([\s\S]*?)<\/span>/);
    const linkM = block.match(/<a[^>]+href="([^"]+)"/);
    if (!dateM || !txtM || !linkM) continue;
    const y = dateM[1], mo = dateM[2].padStart(2,'0'), d = dateM[3].padStart(2,'0');
    const pub = `${y}-${mo}-${d}`;
    const href = linkM[1];
    const url = href.startsWith('http') ? href : `https://www.taxi-tokyo.or.jp/${href.replace(/^\//, '')}`;
    const title = txtM[1].replace(/<[^>]+>/g, '').trim();
    if (!title) continue;
    items.push({ title, link: url, pub, source: '東京ハイヤー・タクシー協会' });
  }
  // 日付降順・重複除去
  const seen = new Set();
  return items.filter(i => { const k = i.title; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.pub.localeCompare(a.pub))
    .slice(0, 10);
}

// タイトルをキーワードセットに変換（助詞・記号・短い語を除去）
function toKeywords(title) {
  return new Set(
    title
      .replace(/[【】「」『』（）()、。・\s]/g, ' ')
      .split(' ')
      .filter(w => w.length >= 3)
      .filter(w => !['について', 'ついて', 'に関して', 'のため', 'による', 'として', 'します', 'された', 'される', 'ました', 'ません', 'タクシー'].includes(w))
  );
}

// 2記事が類似しているか判定（共通キーワード3語以上）
function isSimilar(a, b) {
  const ka = toKeywords(a.title);
  const kb = toKeywords(b.title);
  let common = 0;
  for (const w of ka) { if (kb.has(w)) common++; }
  return common >= 3;
}

// 全ソースをまとめて類似除外（優先度: 協会 > センター > Google）
function dedup(association, center, taxi) {
  const result = [];
  const all = [...association, ...center, ...taxi]; // 優先度順に並べる
  for (const item of all) {
    if (!result.some(r => isSimilar(r, item))) {
      result.push(item);
    }
  }
  // ソースごとに分けて返す
  return {
    association: result.filter(i => i.source === '東京ハイヤー・タクシー協会'),
    center:      result.filter(i => i.source === '東京タクシーセンター'),
    taxi:        result.filter(i => !['東京ハイヤー・タクシー協会','東京タクシーセンター'].includes(i.source)),
  };
}

export default async function handler(req, res) {
  try {
    const [r1, r2, r3] = await Promise.allSettled([
      googleNews('タクシー 東京'),
      tokyoTCNews(),
      taxiAssocNews(),
    ]);

    const taxi        = r1.status === 'fulfilled' ? r1.value.slice(0, 12) : [];
    const center      = r2.status === 'fulfilled' ? r2.value : [];
    const association = r3.status === 'fulfilled' ? r3.value.slice(0, 5) : [];

    const _errors = {};
    if (r1.status !== 'fulfilled') _errors.google    = r1.reason?.message || 'failed';
    if (r2.status !== 'fulfilled') _errors.tokyoTC   = r2.reason?.message || 'failed';
    if (r3.status !== 'fulfilled') _errors.taxiAssoc = r3.reason?.message || 'failed';

    const deduped = dedup(association, center, taxi);

    res.setHeader('Cache-Control', 'public, s-maxage=10800, stale-while-revalidate=600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ ...deduped, _errors });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
