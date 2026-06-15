export default async function handler(req, res) {
  const now = new Date();
  const ver = now.getFullYear()
    + String(now.getMonth()+1).padStart(2,'0')
    + String(now.getDate()).padStart(2,'0')
    + String(now.getHours()).padStart(2,'0')
    + String(now.getMinutes()).padStart(2,'0');

  try {
    const response = await fetch(
      `https://search.shutoko-eng.jp/traffic/kisei-pc-v2.png?ver=${ver}`,
      { headers: { 'Referer': 'https://search.shutoko-eng.jp/' } }
    );
    if (!response.ok) throw new Error('fetch failed');
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 's-maxage=60');
    res.send(Buffer.from(buffer));
  } catch(e) {
    res.status(502).json({ error: 'image fetch failed' });
  }
}
