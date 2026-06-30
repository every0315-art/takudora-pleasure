const OPERATOR_URLS = {
  // JR東日本（専用運行情報システム）
  '山手線':               'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '京浜東北根岸線':       'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '京浜東北・根岸線':     'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '中央線快速':           'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '中央・総武線各駅停車': 'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '中央・総武緩行線':     'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '中央総武線(各停)':     'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '中央本線':             'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '総武線':               'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '総武線快速':           'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '中央線':               'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '埼京線':               'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '湘南新宿ライン':       'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '上野東京ライン':       'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '南武線':               'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  '横浜線':               'https://traininfo.jreast.co.jp/train_info/kanto.aspx',
  // 東京メトロ（路線別運行情報ページ）
  '銀座線':   'https://www.tokyometro.jp/unkou/history/ginza.html',
  '丸ノ内線': 'https://www.tokyometro.jp/unkou/history/marunouchi.html',
  '日比谷線': 'https://www.tokyometro.jp/unkou/history/hibiya.html',
  '東西線':   'https://www.tokyometro.jp/unkou/history/tozai.html',
  '千代田線': 'https://www.tokyometro.jp/unkou/history/chiyoda.html',
  '有楽町線': 'https://www.tokyometro.jp/unkou/history/yurakucho.html',
  '半蔵門線': 'https://www.tokyometro.jp/unkou/history/hanzomon.html',
  '南北線':   'https://www.tokyometro.jp/unkou/history/namboku.html',
  '副都心線': 'https://www.tokyometro.jp/unkou/history/fukutoshin.html',
  // 都営地下鉄
  '都営浅草線': 'https://www.kotsu.metro.tokyo.jp/subway/',
  '都営三田線': 'https://www.kotsu.metro.tokyo.jp/subway/',
  '都営新宿線': 'https://www.kotsu.metro.tokyo.jp/subway/',
  '都営大江戸線':'https://www.kotsu.metro.tokyo.jp/subway/',
  // 東急電鉄
  '東急東横線':     'https://www.tokyu.co.jp/unten2/unten.html',
  '東急田園都市線': 'https://www.tokyu.co.jp/unten2/unten.html',
  '東急目黒線':     'https://www.tokyu.co.jp/unten2/unten.html',
  '東急大井町線':   'https://www.tokyu.co.jp/unten2/unten.html',
  '東急池上線':     'https://www.tokyu.co.jp/unten2/unten.html',
  '東急多摩川線':   'https://www.tokyu.co.jp/unten2/unten.html',
  '東急世田谷線':   'https://www.tokyu.co.jp/unten2/unten.html',
  // 小田急電鉄
  '小田急小田原線': 'https://traininfo.odakyu-rt.jp/train_status',
  '小田急江ノ島線': 'https://traininfo.odakyu-rt.jp/train_status',
  '小田急多摩線':   'https://traininfo.odakyu-rt.jp/train_status',
  // 京王電鉄
  '京王線':       'https://www.keio.co.jp/unkou/unkou_pc.html',
  '京王井の頭線': 'https://www.keio.co.jp/unkou/unkou_pc.html',
  '京王相模原線': 'https://www.keio.co.jp/unkou/unkou_pc.html',
  // 西武鉄道
  '西武新宿線': 'https://www.seiburailway.jp/railway/railwayinfo/',
  '西武池袋線': 'https://www.seiburailway.jp/railway/railwayinfo/',
  // 東武鉄道
  '東武スカイツリーライン': 'https://www.tobu.co.jp/service_status/',
  '東武東上線':             'https://www.tobu.co.jp/service_status/',
  '東武亀戸線':             'https://www.tobu.co.jp/service_status/',
  // 京浜急行電鉄
  '京急本線':   'https://unkou.keikyu.co.jp/',
  '京急空港線': 'https://unkou.keikyu.co.jp/',
  // その他
  'ゆりかもめ':               'https://www.yurikamome.co.jp/ride-guidance/operation.html',
  '東京モノレール':           'https://traininfo.jreast.co.jp/train_info/line.aspx?gid=1&lineid=monorail',
  '東京臨海高速鉄道りんかい線':'http://service.twr.co.jp/service_info/information.html',
  'りんかい線':               'http://service.twr.co.jp/service_info/information.html',
  '北総線':                   'https://www.hokuso-railway.co.jp/train_info/',
  '東葉高速線':               'https://www.toyokosoku.co.jp/station/unkou',
  'つくばエクスプレス':       'https://www.mir.co.jp/info/',
  '多摩都市モノレール':       'https://www.tama-monorail.co.jp/',
};

// 都内主要路線のホワイトリスト
const TOKYO_LINES = new Set([
  // JR
  '山手線','京浜東北根岸線','京浜東北・根岸線',
  '中央線快速','中央・総武線各駅停車','中央・総武緩行線','中央総武線(各停)','中央本線','総武線快速',
  '埼京線','湘南新宿ライン','上野東京ライン','りんかい線','南武線','横浜線',
  '総武線','中央線',
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

// ── 新幹線情報（shinkansen-info.jsを統合） ──
const SHINKANSEN_CONFIG = {
  '東海道新幹線': { color: '#f39c12' },
  '東北新幹線':   { color: '#27ae60' },
  '上越新幹線':   { color: '#2980b9' },
  '北陸新幹線':   { color: '#8e44ad' },
};
async function handleShinkansen(req, res) {
  const ODPT_KEY = process.env.ODPT_KEY;
  const DISPLAY_LINES = ['東海道新幹線', '東北新幹線', '上越新幹線', '北陸新幹線'];
  const UA2 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  function parseDir(arr) {
    if (!arr || arr.length === 0) return [{ dir: '上り', status: '平常運転', message: '' }, { dir: '下り', status: '平常運転', message: '' }];
    if (arr.length >= 2) return arr.slice(0, 2).map((d, i) => ({ dir: i === 0 ? '上り' : '下り', status: d.status || '平常運転', message: d.message || '' }));
    return [{ dir: '上り', status: arr[0].status || '平常運転', message: arr[0].message || '' }, { dir: '下り', status: arr[0].status || '平常運転', message: arr[0].message || '' }];
  }
  const [rYahoo, rODPT] = await Promise.allSettled([
    fetch('https://transit.yahoo.co.jp/diainfo/area/1', { headers: { 'User-Agent': UA2, 'Accept': 'text/html', 'Accept-Language': 'ja' } })
      .then(r => r.text()).then(html => { const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); if (!m) return []; return JSON.parse(m[1])?.props?.pageProps?.troubleRails || []; }),
    ODPT_KEY ? fetch(`https://api.odpt.org/api/4/odpt:TrainInformation?odpt:operator=odpt.Operator:JRCentral&acl:consumerKey=${ODPT_KEY}`).then(r => r.json()) : Promise.resolve(null),
  ]);
  const troubleMap = {};
  if (rYahoo.status === 'fulfilled') rYahoo.value.forEach(r => { const p = r.routeInfo?.property || {}; const name = p.displayName || p.railName || ''; if (SHINKANSEN_CONFIG[name] && !troubleMap[name]) troubleMap[name] = parseDir(p.diainfo); });
  if (rODPT.status === 'fulfilled' && rODPT.value) {
    const items = rODPT.value; const t = items[0]; const text = t?.['odpt:trainInformationText']?.ja || ''; const isNormal = !text || text.includes('平常') || text.includes('通常');
    troubleMap['東海道新幹線'] = [{ dir: '上り', status: isNormal ? '平常運転' : '遅延・運休情報あり', message: text }, { dir: '下り', status: isNormal ? '平常運転' : '遅延・運休情報あり', message: text }];
  }
  const normal = [{ dir: '上り', status: '平常運転', message: '' }, { dir: '下り', status: '平常運転', message: '' }];
  const all = DISPLAY_LINES.map(name => ({ name, color: SHINKANSEN_CONFIG[name].color, directions: troubleMap[name] || normal }));
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ all, updateDate: new Date().toISOString() });
}

export default async function handler(req, res) {
  if (req.query?.type === 'shinkansen') return handleShinkansen(req, res);
  try {
    const debug = req.query?.debug === '1';
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
        return {
          name: p.displayName || p.railName || '',
          company: p.companyName || '',
          status: d.status || '',
          message: d.message || '',
          updatedAt: d.updateDate || '',
          url: OPERATOR_URLS[p.displayName || p.railName || ''] || 'https://transit.yahoo.co.jp/diainfo/area/4',
        };
      })
      .filter(l => debug || TOKYO_LINES.has(l.name) || [...TOKYO_LINES].some(t => l.name.includes(t)));

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ lines, updateDate, ...(debug ? { _debug: true, _total: troubleRails.length } : {}) });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
