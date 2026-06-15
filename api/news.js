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

export default async function handler(req, res) {
  try {
    const [r1, r2, r3] = await Promise.allSettled([
      googleNews('タクシー 東京'),
      tokyoTCNews(),
      taxiAssocNews(),
    ]);

    res.setHeader('Cache-Control', 's-maxage=600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      taxi:        r1.status === 'fulfilled' ? r1.value.slice(0, 12) : [],
      center:      r2.status === 'fulfilled' ? r2.value : [],
      association: r3.status === 'fulfilled' ? r3.value.slice(0,  5) : [],
    });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
