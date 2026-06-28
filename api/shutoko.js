// 首都高情報
// ?type=json → 規制JSON（kisei.json）
// それ以外  → 規制マップ画像（kisei-pc-v2.png）

export default async function handler(req, res) {
  const type = req.query?.type;

  if (type === 'json') {
    try {
      const r = await fetch('https://search.shutoko-eng.jp/traffic/kisei.json', {
        headers: { 'Referer': 'https://search.shutoko-eng.jp/' },
      });
      if (!r.ok) throw new Error('fetch failed');
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.json(await r.json());
    } catch (e) {
      return res.status(502).json({ error: 'fetch failed' });
    }
  }

  // 画像返却（デフォルト）
  const now = new Date();
  const ver = now.getFullYear()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0');

  try {
    const r = await fetch(`https://search.shutoko-eng.jp/traffic/kisei-pc-v2.png?ver=${ver}`, {
      headers: { 'Referer': 'https://search.shutoko-eng.jp/' },
    });
    if (!r.ok) throw new Error('fetch failed');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ error: 'image fetch failed' });
  }
}
