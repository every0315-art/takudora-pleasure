// 東京着発の新幹線運行情報（Yahoo!路線情報より）
const SHINKANSEN_LINES = [
  { name: '東海道新幹線', id: '1',  url: 'https://transit.yahoo.co.jp/traininfo/detail/1/0/' },
  { name: '東北新幹線',   id: '3',  url: 'https://transit.yahoo.co.jp/traininfo/detail/3/0/' },
  { name: '上越新幹線',   id: '5',  url: 'https://transit.yahoo.co.jp/traininfo/detail/5/0/' },
  { name: '北陸新幹線',   id: '4',  url: 'https://transit.yahoo.co.jp/traininfo/detail/4/0/' },
];

async function fetchLineStatus(line) {
  try {
    const res = await fetch(line.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja',
      }
    });
    const html = await res.text();

    // NEXT_DATAからステータスを取得
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      const data = JSON.parse(m[1]);
      const diainfo = data?.props?.pageProps?.diainfo;
      if (diainfo) {
        const status = diainfo.status || '平常運転';
        const message = diainfo.message || diainfo.cause || '';
        return { ...line, status, message };
      }
    }

    // フォールバック: HTMLからステータステキストを抽出
    const statusMatch = html.match(/class="[^"]*status[^"]*"[^>]*>([^<]+)</);
    if (statusMatch) {
      return { ...line, status: statusMatch[1].trim(), message: '' };
    }

    // 「平常通り運転」などのテキストがあれば平常
    if (html.includes('平常通り') || html.includes('平常運転') || html.includes('ございません')) {
      return { ...line, status: '平常運転', message: '' };
    }
    if (html.includes('遅延') || html.includes('見合わせ') || html.includes('運転見合わせ')) {
      const delayMatch = html.match(/([^。<]{0,40}(遅延|見合わせ|運休)[^。<]{0,60})/);
      return { ...line, status: '遅延', message: delayMatch ? delayMatch[1].replace(/<[^>]+>/g,'').trim() : '' };
    }

    return { ...line, status: '平常運転', message: '' };
  } catch(e) {
    return { ...line, status: '取得失敗', message: '' };
  }
}

export default async function handler(req, res) {
  try {
    const results = await Promise.all(SHINKANSEN_LINES.map(fetchLineStatus));
    const lines = results.filter(l => l.status !== '平常運転' && l.status !== '取得失敗');
    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ lines, all: results, updateDate: new Date().toISOString() });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
