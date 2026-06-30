// 全会場スケジュール自動取得 - AIなし・コスト0
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT = 12000;

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractJsonLdEvents(html) {
  const events = [];
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const json = JSON.parse(m[1]);
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item['@type'] === 'Event' || item['@type'] === 'MusicEvent' || item['@type'] === 'SportsEvent') {
          const startRaw = item.startDate || item.startTime || '';
          if (!startRaw) continue;
          const d = new Date(startRaw);
          if (isNaN(d)) continue;
          const date = d.toISOString().slice(0, 10);
          const name = item.name || '';
          if (!name || !date) continue;
          const endRaw = item.endDate || item.endTime || '';
          const endD = endRaw ? new Date(endRaw) : null;
          const start = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          const end = endD && !isNaN(endD) ? `${String(endD.getHours()).padStart(2,'0')}:${String(endD.getMinutes()).padStart(2,'0')}頃` : '';
          events.push({ date, name, start, end, demand: guessDemand(name, 0) });
        }
      }
    } catch (_) {}
  }
  return events;
}

function guessDemand(name, capacity) {
  if (/コミックマーケット|夏コミ|冬コミ/.test(name)) return 'max';
  if (/ワールドツアー|WORLD TOUR|DOME TOUR|全国ツアー|ARENA TOUR/.test(name) && capacity >= 10000) return 'high';
  if (/フェス|FES|FESTIVAL|LIVE|コンサート/.test(name)) return 'medium';
  return 'medium';
}

// イベント名として不正な文字列を弾く
function isValidEventName(name) {
  if (!name || name.length < 4) return false;
  if (/^[（(][月火水木金土日][）)]/.test(name)) return false; // "(金)" のみ
  if (/^[\s（(月火水木金土日）)\d:\/\-]+$/.test(name)) return false; // 記号・数字・曜日のみ
  if (/["'=<>]/.test(name)) return false; // HTML属性の残骸
  if (/月刊|週刊|新聞|雑誌|機関誌/.test(name)) return false; // 出版物名
  return true;
}

// ── NPB スケジュール解析 ──
// NPBページは "6月" の見出し + 日数字のみの行 OR "6月28日" 形式の両方に対応
function parseNpbSchedule(html, venueKeywords, teamName) {
  const events = [];
  const seen = new Set();

  // まず行ベース（<tr>）で解析し、月を追跡
  let currentMonth = 0;
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(c => stripTags(c[1]).trim());
    const rowText = cells.join(' ');

    // 月ヘッダー行の検出（"6月" のみのセルを含む）
    const monthOnly = rowText.match(/^(\d{1,2})月\s*$/);
    if (monthOnly) { currentMonth = Number(monthOnly[1]); continue; }

    // "X月" を含む見出しセル
    const monthHdr = rowText.match(/(\d{1,2})月(?:のスケジュール|の試合|$)/);
    if (monthHdr && cells.length <= 2) { currentMonth = Number(monthHdr[1]); continue; }

    // 日付セルの特定（"28日" or "28" or "6月28日" or "6/28"）
    let month = currentMonth, day = 0;
    for (const cell of cells) {
      const fullDate = cell.match(/(\d{1,2})月(\d{1,2})日/);
      if (fullDate) { month = Number(fullDate[1]); day = Number(fullDate[2]); break; }
      const dayOnly = cell.match(/^(\d{1,2})日?$/);
      if (dayOnly && currentMonth > 0) { day = Number(dayOnly[1]); break; }
      const slashDate = cell.match(/(\d{1,2})\/(\d{1,2})/);
      if (slashDate) { month = Number(slashDate[1]); day = Number(slashDate[2]); break; }
    }
    if (!month || !day) continue;

    const date = `2026-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if (seen.has(date)) continue;
    if (!venueKeywords.some(k => rowText.includes(k))) continue;
    seen.add(date);

    const oppM = rowText.match(/(?:対|vs\.?\s*)([^\s（(0-9]{2,8})/);
    const name = oppM ? `${teamName} vs ${oppM[1].trim()}` : `${teamName} 主催試合`;
    events.push({ date, name, start: '18:00', end: '21:30頃', demand: 'medium' });
  }

  // 行ベースで取れなかった場合はテキストベースにフォールバック
  if (events.length === 0) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const m of text.matchAll(/(\d{1,2})月(\d{1,2})日[^。]{0,400}/g)) {
      if (!venueKeywords.some(k => m[0].includes(k))) continue;
      const mo = m[1].padStart(2,'0'), dy = m[2].padStart(2,'0');
      const date = `2026-${mo}-${dy}`;
      if (seen.has(date)) continue;
      seen.add(date);
      const oppM = m[0].match(/(?:対|vs\.?\s*)([^\s（(0-9]{2,8})/);
      const name = oppM ? `${teamName} vs ${oppM[1].trim()}` : `${teamName} 主催試合`;
      events.push({ date, name, start: '18:00', end: '21:30頃', demand: 'medium' });
    }
  }

  return events;
}

// ── 巨人公式サイト（東京ドーム主催）──
async function fetchGiants() {
  // 巨人公式スケジュールページ
  const res = await fetch('https://www.giants.jp/schedule/', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja', 'Referer': 'https://www.giants.jp/' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const html = await res.text();
  const result = parseNpbSchedule(html, ['東京ドーム', '後楽'], '巨人');
  if (result.length > 0) return result;
  // フォールバック: NPB公式（URL変更に備え複数試行）
  for (const url of [
    'https://npb.jp/games/2026/',
    'https://npb.jp/scores/2026/',
  ]) {
    try {
      const r2 = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(8000) });
      const html2 = await r2.text();
      const r = parseNpbSchedule(html2, ['東京ドーム', '後楽'], '巨人');
      if (r.length > 0) return r;
    } catch (_) {}
  }
  return [];
}

// ── ヤクルト公式サイト（神宮球場主催）──
async function fetchSwallows() {
  const res = await fetch('https://www.yakult-swallows.co.jp/games/2026/', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja', 'Referer': 'https://www.yakult-swallows.co.jp/' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const html = await res.text();
  const result = parseNpbSchedule(html, ['神宮', '明治神宮'], 'ヤクルト');
  if (result.length > 0) return result;
  // フォールバック
  try {
    const r2 = await fetch('https://npb.jp/games/2026/', { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(8000) });
    return parseNpbSchedule(await r2.text(), ['神宮', '明治神宮'], 'ヤクルト');
  } catch (_) { return []; }
}

// ── 東京ドーム（全イベント）──
async function fetchDome() {
  const res = await fetch('https://www.tokyo-dome.co.jp/dome/event/schedule.html', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const html = await res.text();
  const ldEvents = extractJsonLdEvents(html);
  if (ldEvents.length > 0) return ldEvents;

  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');
  const events = [];
  for (const m of textOnly.matchAll(/(\d{4})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})\s*([^\d\n]{5,60}?)(?=\s*\d{4}[\/\.\-]|\s*$)/g)) {
    const date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    const name = m[4].trim().replace(/[\/＋]+$/, '').trim();
    if (isValidEventName(name) && date >= '2026-01-01') {
      events.push({ date, name, start: '', end: '', demand: guessDemand(name, 55000) });
    }
  }
  const seen = new Set();
  return events.filter(e => { const k = e.date+e.name; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── WordPress REST API 経由でイベント取得 ──
async function fetchWordPressEvents(domain, capacity = 10000) {
  // カスタム投稿タイプ（events/event/schedule）と通常投稿を順に試す
  for (const type of ['events', 'event', 'schedule', 'posts']) {
    try {
      const url = `https://${domain}/wp-json/wp/v2/${type}?per_page=30&_fields=title,date,content,excerpt&orderby=date&order=asc`;
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const posts = await res.json();
      if (!Array.isArray(posts) || posts.length === 0) continue;
      const today = new Date().toISOString().slice(0, 10);
      const events = [];
      for (const post of posts) {
        const name = stripTags(post.title?.rendered || '').trim();
        const dateStr = (post.date || '').slice(0, 10);
        if (!name || !dateStr || dateStr < today) continue;
        if (!isValidEventName(name)) continue;
        // コンテンツから開演時刻を探す
        const body = stripTags(post.content?.rendered || post.excerpt?.rendered || '');
        const timeM = body.match(/(?:開演|開場|START)[^\d]*(\d{1,2}:\d{2})/);
        events.push({ date: dateStr, name, start: timeM ? timeM[1] : '', end: '', demand: guessDemand(name, capacity) });
      }
      if (events.length > 0) return events;
    } catch (_) {}
  }
  return [];
}

// ── 汎用: WordPress REST API → JSON-LD → HTML正規表現フォールバック ──
async function fetchVenueGeneric(domain, htmlUrl, venueName, capacity = 10000) {
  // 1st: WordPress REST API
  const wpEvents = await fetchWordPressEvents(domain, capacity);
  if (wpEvents.length > 0) return wpEvents;

  // 2nd: HTML スクレーピング
  const urlsToTry = htmlUrl ? [htmlUrl, `https://${domain}/`, `https://${domain}/events/`, `https://${domain}/event/`] : [`https://${domain}/`];
  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!res.ok) continue;
      const html = await res.text();

      const ldEvents = extractJsonLdEvents(html);
      if (ldEvents.length > 0) return ldEvents.filter(e => isValidEventName(e.name));

      const textOnly = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ');
      const events = [];
      for (const m of textOnly.matchAll(/(?:2026[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})|(\d{1,2})月(\d{1,2})日)\s*([^\d\n]{4,60}?)(?=\s*(?:\d{1,2}月|\d{4}[\/\.\-])|$)/g)) {
        const mo = (m[1] || m[3]).padStart(2,'0');
        const dy = (m[2] || m[4]).padStart(2,'0');
        const date = `2026-${mo}-${dy}`;
        const name = (m[5] || '').trim().replace(/[\/＋（(月火水木金土日）)]+$/, '').trim();
        if (isValidEventName(name)) {
          events.push({ date, name, start: '', end: '', demand: guessDemand(name, capacity) });
        }
      }
      if (events.length > 0) {
        const seen = new Set();
        return events.filter(e => { const k = e.date+e.name; if (seen.has(k)) return false; seen.add(k); return true; });
      }
    } catch (_) {}
  }
  return [];
}

// ── 両国国技館（大相撲）──
async function fetchSumo() {
  const res = await fetch('https://www.sumo.or.jp/Sumo_DB/Match/basho/', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const html = await res.text();
  const events = [];
  for (const m of html.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日[^<]*[〜～\-].*?(\d{1,2})月(\d{1,2})日/g)) {
    if (!['01','05','09'].includes(m[2].padStart(2,'0'))) continue;
    const start = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    for (let i = 0; i < 15; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const date = d.toISOString().slice(0, 10);
      events.push({ date, name: '大相撲 東京場所', start: '8:00', end: '18:00頃', demand: i >= 12 ? 'high' : 'medium' });
    }
  }
  return events;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=10800, stale-while-revalidate=600');

  // ?debug=1 で各会場の生HTMLの先頭を返す（トラブルシューティング用）
  if (req.query?.debug === '1') {
    const venue = req.query.venue || 'giants';
    const urlMap = {
      giants: 'https://npb.jp/games/2026/schedule_yg_all.html',
      swallows: 'https://npb.jp/games/2026/schedule_ys_all.html',
      dome: 'https://www.tokyo-dome.co.jp/dome/event/schedule.html',
      budokan: 'https://www.nipponbudokan.or.jp/houseplan/',
      ariake: 'https://ariake-arena.tokyo/schedule/',
      yoyogi: 'https://www.jpnsport.go.jp/yoyogi/event/tabid/59/default.aspx',
    };
    const url = urlMap[venue] || urlMap.giants;
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(15000) });
    const html = await r.text();
    return res.json({ url, status: r.status, preview: stripTags(html).slice(0, 3000) });
  }

  const [
    rGiants, rSwallows, rDome,
    rKokugikan, rAriake, rGarden,
    rBudokan, rBigsight, rYoyogi, rKokuritsu,
  ] = await Promise.allSettled([
    fetchGiants(),
    fetchSwallows(),
    fetchDome(),
    fetchSumo(),
    fetchVenueGeneric('ariake-arena.tokyo',          'https://ariake-arena.tokyo/event/', '有明アリーナ', 15000),
    fetchVenueGeneric('www.tokyo-garden-theater.jp', 'https://www.tokyo-garden-theater.jp/schedule/', '東京ガーデンシアター', 8000),
    fetchVenueGeneric('www.nipponbudokan.or.jp',     'https://www.nipponbudokan.or.jp/houseplan/', '日本武道館', 14000),
    fetchVenueGeneric('www.bigsight.jp',             'https://www.bigsight.jp/visitor/event/', '東京ビッグサイト', 50000),
    fetchVenueGeneric('www.jpnsport.go.jp',          'https://www.jpnsport.go.jp/yoyogi/event/tabid/59/default.aspx', '代々木第一体育館', 13000),
    fetchVenueGeneric('www.jpnsport.go.jp',          'https://www.jpnsport.go.jp/kokuritsu/event/tabid/64/default.aspx', '国立競技場', 68000),
  ]);

  const ok = r => r.status === 'fulfilled' ? r.value : [];
  const err = r => r.status === 'rejected' ? r.reason?.message : (r.value?.length === 0 ? 'empty' : null);

  return res.json({
    '東京ドーム':           ok(rDome).length ? ok(rDome) : ok(rGiants),
    '神宮球場':             ok(rSwallows),
    '両国国技館':           ok(rKokugikan),
    '有明アリーナ':         ok(rAriake),
    '東京ガーデンシアター': ok(rGarden),
    '日本武道館':           ok(rBudokan),
    '東京ビッグサイト':     ok(rBigsight),
    '代々木第一体育館':     ok(rYoyogi),
    '国立競技場':           ok(rKokuritsu),
    updatedAt: new Date().toISOString(),
    errors: {
      giants:    err(rGiants),
      swallows:  err(rSwallows),
      dome:      err(rDome),
      kokugikan: err(rKokugikan),
      ariake:    err(rAriake),
      garden:    err(rGarden),
      budokan:   err(rBudokan),
      bigsight:  err(rBigsight),
      yoyogi:    err(rYoyogi),
      kokuritsu: err(rKokuritsu),
    },
  });
}
