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
  const items = [];
  // <li> に日付(YYYY.MM.DD)、カテゴリ、<a href="/news/...">タイトル</a> が含まれる構造
  for (const m of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const block = m[1];
    const dateM = block.match(/(\d{4}\.\d{2}\.\d{2})/);
    const linkM = block.match(/<a\s+href="(\/news\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!dateM || !linkM) continue;
    const date = dateM[1];
    const path = linkM[1];
    const title = linkM[2].replace(/<[^>]+>/g, '').trim();
    if (!title) continue;
    items.push({
      title,
      link: `https://www.tokyo-tc.or.jp${path}`,
      pub: date,
      source: '東京タクシーセンター',
    });
  }
  return items.slice(0, 10);
}

export default async function handler(req, res) {
  try {
    const [r1, r2, r3] = await Promise.allSettled([
      googleNews('タクシー 東京'),
      tokyoTCNews(),
      googleNews('東京ハイヤー・タクシー協会'),
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
