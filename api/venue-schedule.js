// 全会場スケジュール自動取得 - AIなし・コスト0
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT = 12000;

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// JSON-LD から Event を抽出（多くのモダンサイトが対応）
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

// ── NPB 巨人（東京ドーム主催）──
async function fetchGiants() {
  const res = await fetch('https://npb.jp/games/2026/schedule_yg_all.html', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const html = await res.text();
  const events = [];
  // NPBスケジュールテーブル: 月・日・球場・対戦相手
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]).trim());
    if (cells.length < 4) continue;
    // 東京ドーム主催試合のみ
    const venueCell = cells.find(c => c.includes('東京ドーム') || c.includes('ドーム'));
    if (!venueCell) continue;
    // 日付
    const dateCell = cells.find(c => /^\d{1,2}月\d{1,2}日/.test(c) || /^\d{4}\/\d{1,2}\/\d{1,2}/.test(c));
    if (!dateCell) continue;
    const dm = dateCell.match(/(\d{1,2})月(\d{1,2})日/) || dateCell.match(/\d{4}\/(\d{1,2})\/(\d{1,2})/);
    if (!dm) continue;
    const mo = dm[1].padStart(2,'0'), dy = dm[2].padStart(2,'0');
    const date = `2026-${mo}-${dy}`;
    // 対戦相手
    const opponent = cells.find(c => /vs|VS|対|巨人以外/.test(c) && c.length < 30 && !/^\d/.test(c) && !c.includes('東京')) || '';
    const name = opponent ? `巨人 vs ${opponent.replace(/[vsVS×〇●]/g, '').trim()}` : '巨人 主催試合';
    events.push({ date, name, start: '18:00', end: '21:30頃', demand: 'medium' });
  }
  return events;
}

// ── NPB ヤクルト（神宮球場主催）──
async function fetchSwallows() {
  const res = await fetch('https://npb.jp/games/2026/schedule_ys_all.html', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const html = await res.text();
  const events = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]).trim());
    if (cells.length < 4) continue;
    const venueCell = cells.find(c => c.includes('神宮') || c.includes('明治神宮'));
    if (!venueCell) continue;
    const dateCell = cells.find(c => /^\d{1,2}月\d{1,2}日/.test(c) || /^\d{4}\/\d{1,2}\/\d{1,2}/.test(c));
    if (!dateCell) continue;
    const dm = dateCell.match(/(\d{1,2})月(\d{1,2})日/) || dateCell.match(/\d{4}\/(\d{1,2})\/(\d{1,2})/);
    if (!dm) continue;
    const mo = dm[1].padStart(2,'0'), dy = dm[2].padStart(2,'0');
    const date = `2026-${mo}-${dy}`;
    const opponent = cells.find(c => c.length < 30 && !/^\d/.test(c) && !c.includes('神宮') && !c.includes('ヤクルト')) || '';
    const name = opponent ? `ヤクルト vs ${opponent.replace(/[vsVS×〇●]/g, '').trim()}` : 'ヤクルト 主催試合';
    events.push({ date, name, start: '18:00', end: '21:30頃', demand: 'medium' });
  }
  return events;
}

// ── 東京ドーム（全イベント）──
async function fetchDome() {
  const res = await fetch('https://www.tokyo-dome.co.jp/dome/event/schedule.html', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const html = await res.text();
  // JSON-LD を試す
  const ldEvents = extractJsonLdEvents(html);
  if (ldEvents.length > 0) return ldEvents;

  // フォールバック: 日付+タイトルパターン
  const events = [];
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  for (const m of text.matchAll(/(\d{4})[\.\-\/](\d{1,2})[\.\-\/](\d{1,2})[^\n<]{0,30}?([^\n<]{5,60})/g)) {
    const date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    const name = stripTags(m[4]).trim();
    if (name && date >= '2026-01-01') {
      events.push({ date, name, start: '', end: '', demand: guessDemand(name, 55000) });
    }
  }
  return events;
}

// ── 汎用: JSON-LD 抽出 → HTML正規表現フォールバック ──
async function fetchVenueGeneric(url, venueName, capacity = 10000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const html = await res.text();

  const ldEvents = extractJsonLdEvents(html);
  if (ldEvents.length > 0) return ldEvents;

  // HTML から日付+タイトルを正規表現で抽出
  const events = [];
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  // パターン1: 2026.MM.DD または 2026/MM/DD または MM月DD日
  for (const m of clean.matchAll(/(?:2026[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})|(\d{1,2})月(\d{1,2})日)[^\n<]{0,10}<[^>]+>([^<]{5,80})/g)) {
    const mo = (m[1] || m[3]).padStart(2,'0');
    const dy = (m[2] || m[4]).padStart(2,'0');
    const date = `2026-${mo}-${dy}`;
    const name = stripTags(m[5]).trim();
    if (name && name.length > 3) {
      events.push({ date, name, start: '', end: '', demand: guessDemand(name, capacity) });
    }
  }
  // 重複除去
  const seen = new Set();
  return events.filter(e => { const k = e.date+e.name; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── 両国国技館（大相撲）──
async function fetchSumo() {
  const res = await fetch('https://www.sumo.or.jp/Sumo_DB/Match/basho/', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const html = await res.text();
  const events = [];
  // 東京場所: 1月・5月・9月（両国国技館）
  for (const m of html.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日[^<]*[〜～\-].*?(\d{1,2})月(\d{1,2})日/g)) {
    const start = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    // 東京場所のみ（1・5・9月）
    if (!['01','05','09'].includes(m[2].padStart(2,'0'))) continue;
    // 15日間分のエントリ
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

  const [
    rGiants, rSwallows, rDome,
    rKokugikan, rAriake, rGarden,
    rBudokan, rBigsight, rYoyogi, rKokuritsu,
  ] = await Promise.allSettled([
    fetchGiants(),
    fetchSwallows(),
    fetchDome(),
    fetchSumo(),
    fetchVenueGeneric('https://ariake-arena.tokyo/event/', '有明アリーナ', 15000),
    fetchVenueGeneric('https://www.shopping-sumitomo-rd.com/tokyo_garden_theater/schedule/', '東京ガーデンシアター', 8000),
    fetchVenueGeneric('https://www.nipponbudokan.or.jp/', '日本武道館', 14000),
    fetchVenueGeneric('https://www.bigsight.jp/visitor/event/', '東京ビッグサイト', 50000),
    fetchVenueGeneric('https://www.jpnsport.go.jp/yoyogi/event/tabid/59/default.aspx', '代々木第一体育館', 13000),
    fetchVenueGeneric('https://jns-e.com/event/', '国立競技場', 68000),
  ]);

  const ok = r => r.status === 'fulfilled' ? r.value : [];

  return res.json({
    '東京ドーム':       ok(rDome).length ? ok(rDome) : ok(rGiants),
    '神宮球場':         ok(rSwallows),
    '両国国技館':       ok(rKokugikan),
    '有明アリーナ':     ok(rAriake),
    '東京ガーデンシアター': ok(rGarden),
    '日本武道館':       ok(rBudokan),
    '東京ビッグサイト': ok(rBigsight),
    '代々木第一体育館': ok(rYoyogi),
    '国立競技場':       ok(rKokuritsu),
    updatedAt: new Date().toISOString(),
    errors: {
      giants:    rGiants.status === 'rejected'    ? rGiants.reason?.message : null,
      swallows:  rSwallows.status === 'rejected'  ? rSwallows.reason?.message : null,
      dome:      rDome.status === 'rejected'       ? rDome.reason?.message : null,
    },
  });
}
