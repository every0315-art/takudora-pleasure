// 新幹線運行情報
// データ取得: Yahoo!路線情報（NEXT_DATA形式 = train-info.js と同方式で動作確認済み）
// リンク先: JR各社公式サイト
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const LINES = [
  {
    name: '東海道新幹線',
    yahooId: '1',   // https://transit.yahoo.co.jp/traininfo/detail/1/0/
    jrUrl:  'https://traininfo.jr-central.co.jp/shinkansen/pc/ja/index.html',
    color:  '#f39c12',
  },
  {
    name: '東北新幹線',
    yahooId: '3',
    jrUrl:  'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx',
    color:  '#27ae60',
  },
  {
    name: '上越新幹線',
    yahooId: '5',
    jrUrl:  'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx',
    color:  '#2980b9',
  },
  {
    name: '北陸新幹線',
    yahooId: '4',
    jrUrl:  'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx',
    color:  '#8e44ad',
  },
];

async function fetchLineStatus(line) {
  const url = `https://transit.yahoo.co.jp/traininfo/detail/${line.yahooId}/0/`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja',
      }
    });
    const html = await res.text();

    // NEXT_DATA から取得（train-info.js と同じ方式）
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      const data = JSON.parse(m[1]);
      const pp = data?.props?.pageProps;

      // 個別路線ページの diainfo 構造を確認
      const diainfo = pp?.diainfo || pp?.troubleRails?.[0]?.routeInfo?.property?.diainfo?.[0];

      // 上下線情報を探す
      const directions = [];
      const upInfo   = pp?.upDiainfo   || pp?.diaInfoUp   || diainfo?.up;
      const downInfo = pp?.downDiainfo || pp?.diaInfoDown || diainfo?.down;

      if (upInfo || downInfo) {
        directions.push({ dir: '上り', status: upInfo?.status   || '平常運転', message: upInfo?.message   || '' });
        directions.push({ dir: '下り', status: downInfo?.status || '平常運転', message: downInfo?.message || '' });
      } else if (diainfo) {
        // 上下区別なし: 同じステータスを両方に適用
        const status  = diainfo.status  || '平常運転';
        const message = diainfo.message || '';
        directions.push({ dir: '上り', status, message });
        directions.push({ dir: '下り', status, message });
      } else {
        // データなし = 平常運転
        directions.push({ dir: '上り', status: '平常運転', message: '' });
        directions.push({ dir: '下り', status: '平常運転', message: '' });
      }

      return { ...line, url: line.jrUrl, directions };
    }

    // フォールバック: HTMLテキストから判断
    const text = html.replace(/<[^>]+>/g, ' ');
    const hasDelay    = text.includes('遅延') || text.includes('遅れ');
    const hasSuspend  = text.includes('運転見合わせ') || text.includes('運休');
    const status = hasSuspend ? '運転見合わせ' : hasDelay ? '遅延' : '平常運転';
    return {
      ...line,
      url: line.jrUrl,
      directions: [
        { dir: '上り', status, message: '' },
        { dir: '下り', status, message: '' },
      ]
    };
  } catch(e) {
    return {
      ...line,
      url: line.jrUrl,
      directions: [
        { dir: '上り', status: '取得失敗', message: '' },
        { dir: '下り', status: '取得失敗', message: '' },
      ]
    };
  }
}

export default async function handler(req, res) {
  try {
    // ?debug=1 でNEXT_DATAの生データを返す（構造確認用）
    if (req.query?.debug === '1') {
      const url = `https://transit.yahoo.co.jp/traininfo/detail/1/0/`;
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
      const html = await r.text();
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      const raw = m ? JSON.parse(m[1])?.props?.pageProps : { error: 'NEXT_DATA not found' };
      return res.json({ debug: true, pageProps: raw });
    }

    const all = await Promise.all(LINES.map(fetchLineStatus));
    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ all, updateDate: new Date().toISOString() });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
