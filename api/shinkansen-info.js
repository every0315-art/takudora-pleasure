// 新幹線運行情報
// Yahoo!路線情報 エリア1（新幹線）から取得 — train-info.js と同じ NEXT_DATA 方式
// リンク先: JR各社公式サイト

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const LINE_CONFIG = {
  '東海道新幹線': { color: '#f39c12', jrUrl: 'https://traininfo.jr-central.co.jp/shinkansen/pc/ja/index.html' },
  '東北新幹線':   { color: '#27ae60', jrUrl: 'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx' },
  '上越新幹線':   { color: '#2980b9', jrUrl: 'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx' },
  '北陸新幹線':   { color: '#8e44ad', jrUrl: 'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx' },
  '山形新幹線':   { color: '#16a085', jrUrl: 'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx' },
  '秋田新幹線':   { color: '#c0392b', jrUrl: 'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx' },
};

// diainfo 配列を上り/下り別に整理
function parseDirections(diainfoArr) {
  if (!diainfoArr || diainfoArr.length === 0) {
    return [{ dir: '上り', status: '平常運転', message: '' }, { dir: '下り', status: '平常運転', message: '' }];
  }
  if (diainfoArr.length >= 2) {
    // 複数エントリがあれば上り/下り別
    return diainfoArr.slice(0, 2).map((d, i) => ({
      dir: i === 0 ? '上り' : '下り',
      status: d.status || '平常運転',
      message: d.message || '',
    }));
  }
  // 1件 = 上下共通
  const status  = diainfoArr[0].status  || '平常運転';
  const message = diainfoArr[0].message || '';
  return [
    { dir: '上り', status, message },
    { dir: '下り', status, message },
  ];
}

export default async function handler(req, res) {
  try {
    // ?debug=1 で pageProps 生データを返す
    if (req.query?.debug === '1') {
      const r = await fetch('https://transit.yahoo.co.jp/diainfo/area/1', {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ja' }
      });
      const html = await r.text();
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      const raw = m ? JSON.parse(m[1])?.props?.pageProps : { error: 'NEXT_DATA not found' };
      return res.json({ debug: true, pageProps: raw });
    }

    const response = await fetch('https://transit.yahoo.co.jp/diainfo/area/1', {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja',
      }
    });
    const html = await response.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('NEXT_DATA not found');

    const data = JSON.parse(m[1]);
    const troubleRails = data?.props?.pageProps?.troubleRails || [];

    // 障害のある路線をマップ化
    const troubleMap = {};
    troubleRails.forEach(r => {
      const p   = r.routeInfo?.property || {};
      const name = p.displayName || p.railName || '';
      if (LINE_CONFIG[name]) {
        troubleMap[name] = parseDirections(p.diainfo);
      }
    });

    // 全対象路線を出力（平常 or 障害）
    const all = Object.entries(LINE_CONFIG).map(([name, cfg]) => ({
      name,
      url: cfg.jrUrl,
      color: cfg.color,
      directions: troubleMap[name] || [
        { dir: '上り', status: '平常運転', message: '' },
        { dir: '下り', status: '平常運転', message: '' },
      ],
    }));

    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ all, updateDate: new Date().toISOString() });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
