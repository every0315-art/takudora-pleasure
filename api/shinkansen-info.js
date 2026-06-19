// 新幹線運行情報
// JR東海: traininfo.jr-central.co.jp 直接取得
// JR東日本: traininfo.jreast.co.jp 直接取得

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ステータス文字列を判定
function classifyStatus(text) {
  if (!text) return '平常運転';
  if (text.includes('運転見合わせ') || text.includes('運休')) return '運転見合わせ';
  if (text.includes('遅れ') || text.includes('遅延')) return '遅延';
  if (text.includes('平常') || text.includes('通常') || text.includes('ございません')) return '平常運転';
  return '平常運転';
}

// ─── JR東海：東海道新幹線 ────────────────────────────────────────
async function fetchTokaido() {
  const url = 'https://traininfo.jr-central.co.jp/shinkansen/pc/ja/index.html';
  const result = {
    name: '東海道新幹線',
    url: 'https://traininfo.jr-central.co.jp/shinkansen/pc/ja/index.html',
    color: '#f39c12',
    directions: [
      { dir: '上り', status: '平常運転', message: '' },
      { dir: '下り', status: '平常運転', message: '' },
    ]
  };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ja', 'Accept': 'text/html' }
    });
    const html = await res.text();
    const text = strip(html);

    // JR東海ページの典型パターン:
    // "平常通り運転しています" → 平常
    // "遅れのお知らせ" / "遅れが発生" → 遅延
    // "運転見合わせ" / "運休" → 運転見合わせ

    // まず全体ステータスを判定
    const overallStatus = classifyStatus(text);

    // 上り/下り個別に探す
    const upMatch   = text.match(/上り[^\n。]{0,80}/g);
    const downMatch = text.match(/下り[^\n。]{0,80}/g);

    const upStatus   = upMatch   ? classifyStatus(upMatch.join(' '))   : overallStatus;
    const downStatus = downMatch ? classifyStatus(downMatch.join(' ')) : overallStatus;

    // メッセージ本文を抽出（先頭100文字）
    let message = '';
    if (overallStatus !== '平常運転') {
      const msgMatch = text.match(/(?:遅れのお知らせ|運転見合わせ|遅れが発生)[^\n]{0,150}/);
      if (msgMatch) message = msgMatch[0].slice(0, 100);
    }

    result.directions = [
      { dir: '上り', status: upStatus,   message },
      { dir: '下り', status: downStatus, message },
    ];
  } catch(e) {
    result.directions = [
      { dir: '上り', status: '取得失敗', message: '' },
      { dir: '下り', status: '取得失敗', message: '' },
    ];
  }
  return result;
}

// ─── JR東日本：東北・上越・北陸新幹線 ────────────────────────────
const JREAST_LINES = [
  { name: '東北新幹線', color: '#27ae60' },
  { name: '上越新幹線', color: '#2980b9' },
  { name: '北陸新幹線', color: '#8e44ad' },
  { name: '山形新幹線', color: '#16a085' },
  { name: '秋田新幹線', color: '#c0392b' },
];
const JREAST_URL = 'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx';

async function fetchJREast() {
  const defaults = JREAST_LINES.map(l => ({
    ...l,
    url: JREAST_URL,
    directions: [
      { dir: '上り', status: '平常運転', message: '' },
      { dir: '下り', status: '平常運転', message: '' },
    ]
  }));
  try {
    const res = await fetch(JREAST_URL, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ja', 'Accept': 'text/html' }
    });
    const html = await res.text();

    return JREAST_LINES.map(line => {
      // 路線名前後のブロックを抽出
      const idx = html.indexOf(line.name);
      if (idx === -1) return { ...line, url: JREAST_URL, directions: [{ dir: '上り', status: '平常運転', message: '' }, { dir: '下り', status: '平常運転', message: '' }] };

      const block = strip(html.slice(idx, idx + 800));

      // 上り・下り別に判定
      const upIdx   = block.indexOf('上り');
      const downIdx = block.indexOf('下り');

      let upStatus = '平常運転', downStatus = '平常運転', upMsg = '', downMsg = '';

      if (upIdx !== -1 && downIdx !== -1) {
        const upText   = block.slice(upIdx,   downIdx > upIdx   ? downIdx   : upIdx + 200);
        const downText = block.slice(downIdx, downIdx + 200);
        upStatus   = classifyStatus(upText);
        downStatus = classifyStatus(downText);
        if (upStatus !== '平常運転')   upMsg   = upText.slice(0, 80);
        if (downStatus !== '平常運転') downMsg = downText.slice(0, 80);
      } else {
        const s = classifyStatus(block);
        upStatus = downStatus = s;
        if (s !== '平常運転') upMsg = downMsg = block.slice(0, 80);
      }

      return {
        name: line.name,
        color: line.color,
        url: JREAST_URL,
        directions: [
          { dir: '上り', status: upStatus,   message: upMsg },
          { dir: '下り', status: downStatus, message: downMsg },
        ]
      };
    });
  } catch(e) {
    return defaults;
  }
}

export default async function handler(req, res) {
  try {
    // ?debug=1 でJR東海の候補JSONエンドポイントを一括試行
    if (req.query?.debug === '1') {
      const candidates = [
        'https://traininfo.jr-central.co.jp/shinkansen/pc/ja/json/shinkansen.json',
        'https://traininfo.jr-central.co.jp/shinkansen/json/shinkansen.json',
        'https://traininfo.jr-central.co.jp/api/shinkansen',
        'https://traininfo.jr-central.co.jp/shinkansen/sp/ja/index.html',
        'https://jr-central.co.jp/info.html',
      ];
      const results = await Promise.all(candidates.map(async url => {
        try {
          const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
          const body = await r.text();
          return { url, status: r.status, preview: strip(body).slice(0, 300) };
        } catch(e) {
          return { url, error: e.message };
        }
      }));
      return res.json({ debug: true, results });
    }

    const [tokaido, eastLines] = await Promise.all([fetchTokaido(), fetchJREast()]);
    const all = [tokaido, ...eastLines];

    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ all, updateDate: new Date().toISOString() });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
