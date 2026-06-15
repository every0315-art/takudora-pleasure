export default async function handler(req, res) {
  try {
    const response = await fetch(
      'https://search.shutoko-eng.jp/traffic/kisei.json',
      { headers: { 'Referer': 'https://search.shutoko-eng.jp/' } }
    );
    if (!response.ok) throw new Error('fetch failed');
    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch(e) {
    res.status(502).json({ error: 'fetch failed' });
  }
}
