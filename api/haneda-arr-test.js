export default async function handler(req, res) {
  const results = {};
  const urls = [
    { key: 'dom_t1', url: 'https://www.haneda-airport.jp/dom/arr/t1/' },
    { key: 'dom_t2', url: 'https://www.haneda-airport.jp/dom/arr/t2/' },
    { key: 'inter',  url: 'https://www.haneda-airport.jp/inter/arr/' },
  ];
  for (const { key, url } of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja',
        },
        signal: AbortSignal.timeout(8000),
      });
      const html = await r.text();
      results[key] = { status: r.status, length: html.length, snippet: html.slice(0, 2000) };
    } catch(e) {
      results[key] = { error: e.message };
    }
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(results);
}
