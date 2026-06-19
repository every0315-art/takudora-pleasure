// 新幹線運行情報 - JR公式サイトから上下線別に取得
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// HTML タグ・エンティティ除去
const stripHtml = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();

// ステータス文字列を正規化
function normalizeStatus(text) {
  if (!text) return '平常運転';
  const t = stripHtml(text).replace(/\s+/g, ' ').trim();
  if (t.includes('運転見合わせ') || t.includes('運休')) return '運転見合わせ';
  if (t.includes('遅延') || t.includes('遅れ')) return '遅延';
  if (t.includes('通常') || t.includes('平常') || t.includes('平通') || t.includes('ございません')) return '平常運転';
  if (t.length > 2 && t.length < 60) return t; // 短いテキストはそのまま返す
  return '平常運転';
}

// ─── JR東海：東海道新幹線 ───────────────────────────────────────
async function fetchJRCentral() {
  const url = 'https://traininfo.jr-central.co.jp/shinkansen/pc/ja/index.html';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
    const html = await res.text();

    // JR東海サイトの構造: class="up" / class="down" などに上下線情報
    // あるいは <td> の中に「上り」「下り」とセットで状態テキスト
    const lines = [];

    // パターン1: JSON-LD or data attribute
    const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
    if (jsonMatch) {
      try {
        const d = JSON.parse(jsonMatch[1]);
        // 構造に依存するため以下はベストエフォート
        const info = d?.trainInfo || d?.shinkansen || {};
        ['上り','下り'].forEach(dir => {
          const s = info[dir] || info[dir === '上り' ? 'up' : 'down'];
          if (s) lines.push({ dir, status: normalizeStatus(s.status || s), message: stripHtml(s.message || '') });
        });
      } catch(e) {}
    }

    if (lines.length === 0) {
      // パターン2: HTMLの上り/下りブロックをテキスト解析
      // 「上り」「下り」のラベル付近のステータステキストを抽出
      const upMatch   = html.match(/上り[\s\S]{0,300}?(<(?:td|div|span|p)[^>]*>)([\s\S]{0,200}?)(?=下り|<\/table|上り)/i);
      const downMatch = html.match(/下り[\s\S]{0,300}?(<(?:td|div|span|p)[^>]*>)([\s\S]{0,200}?)(?=上り|<\/table|$)/i);

      const upStatus   = upMatch   ? normalizeStatus(upMatch[2])   : '平常運転';
      const downStatus = downMatch ? normalizeStatus(downMatch[2]) : '平常運転';

      lines.push({ dir: '上り', status: upStatus,   message: '' });
      lines.push({ dir: '下り', status: downStatus, message: '' });
    }

    return {
      name: '東海道新幹線',
      url,
      directions: lines,
    };
  } catch(e) {
    return { name: '東海道新幹線', url, directions: [{ dir: '上り', status: '取得失敗', message: '' }, { dir: '下り', status: '取得失敗', message: '' }] };
  }
}

// ─── JR東日本：東北・上越・北陸新幹線 ────────────────────────────
async function fetchJREast() {
  const url = 'https://traininfo.jreast.co.jp/train_info/shinkansen.aspx';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
    const html = await res.text();

    const targetLines = ['東北新幹線', '上越新幹線', '北陸新幹線', '山形新幹線', '秋田新幹線'];
    const results = [];

    // JR東日本サイト: 各路線ブロックを抽出
    // 通常は <tr> or <div> に路線名 + 上り/下りのセル
    // テーブル行を抽出して路線名でマッチ
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const lineName = targetLines.find(n => row.includes(n));
      if (!lineName) continue;

      // この行またはその後の行から上り/下りを探す
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      const texts = cells.map(c => stripHtml(c).replace(/\s+/g,' ').trim()).filter(Boolean);

      // JR東日本の典型的な並び: [路線名, 上り状態, 下り状態] or [路線名, 上り, 下り, ...]
      let upStatus = '平常運転', downStatus = '平常運転';
      if (texts.length >= 3) {
        upStatus   = normalizeStatus(texts[1]);
        downStatus = normalizeStatus(texts[2]);
      } else if (texts.length === 2) {
        upStatus   = normalizeStatus(texts[1]);
        downStatus = normalizeStatus(texts[1]);
      }

      results.push({
        name: lineName,
        url,
        directions: [
          { dir: '上り', status: upStatus,   message: '' },
          { dir: '下り', status: downStatus, message: '' },
        ]
      });
    }

    // テーブル解析で取れなかった路線は正規表現で補完
    for (const name of targetLines) {
      if (results.find(r => r.name === name)) continue;
      const block = html.match(new RegExp(name + '[\\s\\S]{0,600}?(?=' + targetLines.filter(n=>n!==name).join('|') + '|$)'));
      if (!block) continue;
      const upM   = block[0].match(/上り[\s\S]{0,100}?(通常|平常|遅延|見合わせ|運休)/);
      const downM = block[0].match(/下り[\s\S]{0,100}?(通常|平常|遅延|見合わせ|運休)/);
      results.push({
        name,
        url,
        directions: [
          { dir: '上り', status: upM   ? normalizeStatus(upM[1])   : '平常運転', message: '' },
          { dir: '下り', status: downM ? normalizeStatus(downM[1]) : '平常運転', message: '' },
        ]
      });
    }

    return results;
  } catch(e) {
    return ['東北新幹線','上越新幹線','北陸新幹線'].map(name => ({
      name,
      url,
      directions: [{ dir: '上り', status: '取得失敗', message: '' }, { dir: '下り', status: '取得失敗', message: '' }]
    }));
  }
}

export default async function handler(req, res) {
  try {
    const [central, eastLines] = await Promise.all([fetchJRCentral(), fetchJREast()]);
    const all = [central, ...eastLines];

    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ all, updateDate: new Date().toISOString() });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
