// 新幹線運行情報
// Yahoo!路線情報 全国diainfo から東海道・東北・上越・北陸新幹線を取得
// リンク先: JR各社公式サイト

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

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
    return diainfoArr.slice(0, 2).map((d, i) => ({
      dir: i === 0 ? '上り' : '下り',
      status: d.status || '平常運転',
      message: d.message || '',
    }));
  }
  const status  = diainfoArr[0].status  || '平常運転';
  const message = diainfoArr[0].message || '';
  return [
    { dir: '上り', status, message },
    { dir: '下り', status, message },
  ];
}

// Yahoo全国diainfo からtrouble路線を取得
async function fetchFromYahoo(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja',
    }
  });
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('NEXT_DATA not found');
  const data = JSON.parse(m[1]);
  return data?.props?.pageProps?.troubleRails || [];
}

export default async function handler(req, res) {
  try {
    // ?debug=1 でtrouble路線の一覧を確認
    if (req.query?.debug === '1') {
      const urls = [
        'https://transit.yahoo.co.jp/diainfo/',
        'https://transit.yahoo.co.jp/diainfo/area/1',
        'https://transit.yahoo.co.jp/diainfo/area/3',
        'https://transit.yahoo.co.jp/diainfo/area/5',
      ];
      const results = await Promise.all(urls.map(async url => {
        try {
          const rails = await fetchFromYahoo(url);
          return { url, count: rails.length, lines: rails.map(r => r.routeInfo?.property?.displayName) };
        } catch(e) {
          return { url, error: e.message };
        }
      }));
      return res.json({ debug: true, results });
    }

    // 全国 diainfo と 新幹線エリア の両方を取得してマージ
    const [allRails, shinkansenRails] = await Promise.allSettled([
      fetchFromYahoo('https://transit.yahoo.co.jp/diainfo/'),
      fetchFromYahoo('https://transit.yahoo.co.jp/diainfo/area/1'),
    ]);

    const troubleRails = [
      ...(allRails.status === 'fulfilled' ? allRails.value : []),
      ...(shinkansenRails.status === 'fulfilled' ? shinkansenRails.value : []),
    ];

    // 障害のある路線をマップ化（重複は最初のエントリを優先）
    const troubleMap = {};
    troubleRails.forEach(r => {
      const p    = r.routeInfo?.property || {};
      const name = p.displayName || p.railName || '';
      if (LINE_CONFIG[name] && !troubleMap[name]) {
        troubleMap[name] = parseDirections(p.diainfo);
      }
    });

    // 全対象路線を出力
    const DISPLAY_LINES = ['東海道新幹線', '東北新幹線', '上越新幹線', '北陸新幹線'];
    const all = DISPLAY_LINES.map(name => ({
      name,
      url:   LINE_CONFIG[name].jrUrl,
      color: LINE_CONFIG[name].color,
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
