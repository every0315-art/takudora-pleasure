// 新幹線運行情報
// JR東日本: Yahoo!路線情報 全国diainfo
// JR東海（東海道新幹線）: ODPT公共交通オープンデータ

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const LINE_CONFIG = {
  '東海道新幹線': { color: '#f39c12', jrUrl: 'https://traininfo.jr-central.co.jp/shinkansen/pc/ja/index.html' },
  '東北新幹線':   { color: '#27ae60', jrUrl: 'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx' },
  '上越新幹線':   { color: '#2980b9', jrUrl: 'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx' },
  '北陸新幹線':   { color: '#8e44ad', jrUrl: 'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx' },
};

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

async function fetchFromYahoo(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'ja' }
  });
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('NEXT_DATA not found');
  const data = JSON.parse(m[1]);
  return data?.props?.pageProps?.troubleRails || [];
}

// ODPT から東海道新幹線の運行情報を取得
// odpt:railDirection: odpt.RailDirection:Outbound=下り, Inbound=上り
async function fetchTokaidoFromODPT(apiKey) {
  const url = `https://api.odpt.org/api/4/odpt:TrainInformation?odpt:operator=odpt.Operator:JRCentral&acl:consumerKey=${apiKey}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`ODPT ${res.status}`);
  const items = await res.json();

  // 東海道新幹線のみフィルタ（他線 = 在来線も含まれる）
  const tokaido = items.filter(item => {
    const railway = item['odpt:railway'] || '';
    return railway.includes('Tokaido') || railway.includes('東海道');
  });

  if (tokaido.length === 0) {
    // 全線共通の情報として扱う
    const all = items[0];
    if (!all) return [{ dir: '上り', status: '平常運転', message: '' }, { dir: '下り', status: '平常運転', message: '' }];
    const text = all['odpt:trainInformationText']?.ja || all['odpt:trainInformationText'] || '';
    const isNormal = !text || text.includes('平常') || text.includes('通常');
    const status = isNormal ? '平常運転' : '遅延・運休情報あり';
    return [{ dir: '上り', status, message: text }, { dir: '下り', status, message: text }];
  }

  // 方向別に整理
  const dirMap = { up: null, down: null };
  for (const item of tokaido) {
    const dir  = item['odpt:railDirection'] || '';
    const text = item['odpt:trainInformationText']?.ja || item['odpt:trainInformationText'] || '';
    const isNormal = !text || text.includes('平常') || text.includes('通常');
    const entry = { status: isNormal ? '平常運転' : '遅延・運休情報あり', message: text };
    if (dir.includes('Inbound')) dirMap.up = entry;
    else if (dir.includes('Outbound')) dirMap.down = entry;
    else { dirMap.up = dirMap.up || entry; dirMap.down = dirMap.down || entry; }
  }

  return [
    { dir: '上り', ...(dirMap.up   || { status: '平常運転', message: '' }) },
    { dir: '下り', ...(dirMap.down || { status: '平常運転', message: '' }) },
  ];
}

export default async function handler(req, res) {
  try {
    const ODPT_KEY = process.env.ODPT_KEY;
    const DISPLAY_LINES = ['東海道新幹線', '東北新幹線', '上越新幹線', '北陸新幹線'];

    // JR東日本 3線: Yahoo diainfo / 東海道新幹線: ODPT
    const [shinkansenRails, tokaidoDirections] = await Promise.allSettled([
      fetchFromYahoo('https://transit.yahoo.co.jp/diainfo/area/1'),
      ODPT_KEY ? fetchTokaidoFromODPT(ODPT_KEY) : Promise.resolve(null),
    ]);

    // Yahoo の JR東日本 路線をマップ化
    const troubleMap = {};
    if (shinkansenRails.status === 'fulfilled') {
      shinkansenRails.value.forEach(r => {
        const p    = r.routeInfo?.property || {};
        const name = p.displayName || p.railName || '';
        if (LINE_CONFIG[name] && !troubleMap[name]) {
          troubleMap[name] = parseDirections(p.diainfo);
        }
      });
    }

    // 東海道新幹線は ODPT 結果を使用
    if (tokaidoDirections.status === 'fulfilled' && tokaidoDirections.value) {
      troubleMap['東海道新幹線'] = tokaidoDirections.value;
    }

    const normal = [
      { dir: '上り', status: '平常運転', message: '' },
      { dir: '下り', status: '平常運転', message: '' },
    ];

    const all = DISPLAY_LINES.map(name => ({
      name,
      url:        LINE_CONFIG[name].jrUrl,
      color:      LINE_CONFIG[name].color,
      directions: troubleMap[name] || normal,
    }));

    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ all, updateDate: new Date().toISOString() });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
