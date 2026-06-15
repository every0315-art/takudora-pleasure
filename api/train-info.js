// 都内主要路線のホワイトリスト
const TOKYO_LINES = new Set([
  // JR
  '山手線','京浜東北根岸線','中央線快速','中央・総武線各駅停車','中央本線','総武線快速',
  '埼京線','湘南新宿ライン','上野東京ライン','りんかい線','南武線','横浜線',
  // 東京メトロ
  '銀座線','丸ノ内線','日比谷線','東西線','千代田線',
  '有楽町線','半蔵門線','南北線','副都心線',
  // 都営
  '都営浅草線','都営三田線','都営新宿線','都営大江戸線',
  // 私鉄
  '東急東横線','東急田園都市線','東急目黒線','東急大井町線','東急池上線','東急多摩川線',
  '小田急小田原線','小田急江ノ島線','小田急多摩線',
  '京王線','京王井の頭線','京王相模原線',
  '西武新宿線','西武池袋線',
  '東武スカイツリーライン','東武東上線','東武亀戸線',
  '京急本線','京急空港線',
  'ゆりかもめ','東京モノレール','東京臨海高速鉄道りんかい線',
  '北総線','東葉高速線','つくばエクスプレス',
  '多摩都市モノレール','東急世田谷線',
]);

export default async function handler(req, res) {
  try {
    const response = await fetch('https://transit.yahoo.co.jp/diainfo/area/4', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja',
      }
    });
    const html = await response.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('NEXT_DATA not found');

    const data = JSON.parse(m[1]);
    const troubleRails = data?.props?.pageProps?.troubleRails || [];
    const updateDate = data?.props?.pageProps?.diainfoCheckParam?.localDetails?.find(d => d.railAreaCode === '4')?.diainfo?.updateDate || '';

    const lines = troubleRails
      .map(r => {
        const p = r.routeInfo?.property || {};
        const d = p.diainfo?.[0] || {};
        const railCode = r.routeInfo?.railCode || '';
        return {
          name: p.displayName || p.railName || '',
          company: p.companyName || '',
          status: d.status || '',
          message: d.message || '',
          updatedAt: d.updateDate || '',
          url: railCode
            ? `https://transit.yahoo.co.jp/diainfo/${railCode}/0`
            : 'https://transit.yahoo.co.jp/diainfo/area/4',
        };
      })
      .filter(l => TOKYO_LINES.has(l.name));

    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ lines, updateDate });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
