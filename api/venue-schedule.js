// 全会場スケジュール自動取得
// 無料スクレーピング優先、取れない場合のみ Claude Haiku にフォールバック
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
        if (!['Event','MusicEvent','SportsEvent'].includes(item['@type'])) continue;
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

function isValidEventName(name) {
  if (!name || name.length < 4) return false;
  if (/^[（(][月火水木金土日][）)]/.test(name)) return false;
  if (/^[\s（(月火水木金土日）)\d:\/\-]+$/.test(name)) return false;
  if (/["'=<>]/.test(name)) return false;
  if (/月刊|週刊|新聞|雑誌|機関誌/.test(name)) return false;
  return true;
}

// ── Claude Haiku フォールバック ──
async function callClaudeForEvents(html, venueName, capacity) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const text = stripTags(html).slice(0, 15000);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `以下は「${venueName}」のウェブページテキストです。2026年以降のイベント・公演・試合スケジュールをJSON配列で抽出してください。
形式: [{"date":"2026-MM-DD","endDate":"2026-MM-DD","name":"イベント名","start":"HH:MM","end":"HH:MM頃"}]
・dateは開始日、endDateは終了日（1日のみの場合はdateと同じ）
・同じ会場・同じ日程で同時開催されるサブ展示・併催展は、最も上位の親イベント名1件にまとめること（例:「〇〇ワールド」傘下の各展示は「〇〇ワールド」1件として返す）
・日付・名前が不明なものは除外
・JSONのみ返す（説明文不要）

${text}`,
      }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  const content = data.content?.[0]?.text || '';
  const m = content.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const events = JSON.parse(m[0]);
    const today = new Date().toISOString().slice(0, 10);
    const result = [];
    for (const e of events) {
      if (!isValidEventName(e.name)) continue;
      if (e.date < today) continue;
      const endDate = e.endDate || e.date;
      if (endDate >= today) {
        result.push({ date: e.date, endDate, name: e.name, start: e.start || '', end: e.end || '', demand: guessDemand(e.name, capacity) });
      }
    }
    return result;
  } catch (_) { return []; }
}

// ── WordPress REST API ──
async function fetchWordPressEvents(domain, capacity) {
  for (const type of ['events', 'event', 'schedule', 'posts']) {
    try {
      const url = `https://${domain}/wp-json/wp/v2/${type}?per_page=30&_fields=title,date,content,excerpt&orderby=date&order=asc`;
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const posts = await res.json();
      if (!Array.isArray(posts) || posts.length === 0) continue;
      const today = new Date().toISOString().slice(0, 10);
      const events = [];
      for (const post of posts) {
        const name = stripTags(post.title?.rendered || '').trim();
        const dateStr = (post.date || '').slice(0, 10);
        if (!name || !dateStr || dateStr < today || !isValidEventName(name)) continue;
        const body = stripTags(post.content?.rendered || post.excerpt?.rendered || '');
        const timeM = body.match(/(?:開演|開場|START)[^\d]*(\d{1,2}:\d{2})/);
        events.push({ date: dateStr, name, start: timeM ? timeM[1] : '', end: '', demand: guessDemand(name, capacity) });
      }
      if (events.length > 0) return events;
    } catch (_) {}
  }
  return [];
}

// ── 無料取得 → ダメならAI ──
async function fetchWithFallback(freeFn, htmlUrls, domain, venueName, capacity) {
  // 1. 無料メソッド
  const free = await freeFn().catch(() => []);
  if (free.length > 0) return free;

  // 2. WordPress REST API（WordPressサイトの場合）
  if (domain) {
    const wp = await fetchWordPressEvents(domain, capacity);
    if (wp.length > 0) return wp;
  }

  // 3. HTML + JSON-LD スクレーピング
  for (const url of (htmlUrls || [])) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) continue;
      const html = await res.text();
      const ldEvents = extractJsonLdEvents(html).filter(e => isValidEventName(e.name));
      if (ldEvents.length > 0) return ldEvents;
      // 4. 最終手段: Claude Haiku
      const aiEvents = await callClaudeForEvents(html, venueName, capacity);
      if (aiEvents.length > 0) return aiEvents;
    } catch (_) {}
  }
  return [];
}

// ── NPB スケジュール解析 ──
function parseNpbSchedule(html, venueKeywords, teamName) {
  const events = [];
  const seen = new Set();
  let currentMonth = 0;

  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(c => stripTags(c[1]).trim());
    const rowText = cells.join(' ');
    const monthOnly = rowText.match(/^(\d{1,2})月\s*$/);
    if (monthOnly) { currentMonth = Number(monthOnly[1]); continue; }
    const monthHdr = rowText.match(/(\d{1,2})月(?:のスケジュール|の試合|$)/);
    if (monthHdr && cells.length <= 2) { currentMonth = Number(monthHdr[1]); continue; }

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

// ── 各会場の無料取得関数 ──
async function freeGiants() {
  // giants.jp はbot対策でブロックのため npb.jp のみ使用
  try {
    const res = await fetch('https://npb.jp/games/2026/', { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return [];
    const r = parseNpbSchedule(await res.text(), ['東京ドーム', '後楽'], '巨人');
    if (r.length > 0) return r;
  } catch (_) {}
  return [];
}

async function freeSwallows() {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const events = [];
  // 正しいURL: /game（/games/2026/ は404）、当月・翌月・翌々月を取得
  for (let mi = 0; mi < 3; mi++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mi, 1);
    const year = d.getFullYear(), month = d.getMonth() + 1;
    try {
      const url = `https://www.yakult-swallows.co.jp/game?year=${year}&month=${month}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) continue;
      const html = await res.text();
      const r = parseNpbSchedule(html, ['神宮', '明治神宮'], 'ヤクルト');
      events.push(...r.filter(e => e.date >= today));
    } catch (_) {}
  }
  if (events.length > 0) return events;
  // フォールバック: npb.jp
  try {
    const res = await fetch('https://npb.jp/games/2026/', { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return [];
    return parseNpbSchedule(await res.text(), ['神宮', '明治神宮'], 'ヤクルト');
  } catch (_) { return []; }
}

// 武道館: WP REST API で公演情報取得
async function freeBudokan() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch('https://www.nipponbudokan.or.jp/wp-json/wp/v2/posts?per_page=50&orderby=date&order=asc', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return [];
    const posts = await res.json();
    if (!Array.isArray(posts)) return [];
    const events = [];
    for (const post of posts) {
      const title = stripTags(post.title?.rendered || '').trim();
      if (!isValidEventName(title)) continue;
      // タイトルや本文から日付を抽出（令和8年X月Y日 or 2026/X/Y or YYYY-MM-DD）
      const body = stripTags(post.content?.rendered || post.excerpt?.rendered || '');
      const full = title + ' ' + body;
      let date = null;
      // 令和8年 = 2026年
      const waM = full.match(/令和\s*8\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (waM) date = `2026-${waM[1].padStart(2,'0')}-${waM[2].padStart(2,'0')}`;
      if (!date) {
        const ymM = full.match(/2026[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (ymM) date = `2026-${ymM[1].padStart(2,'0')}-${ymM[2].padStart(2,'0')}`;
      }
      if (!date || date < today) continue;
      const timeM = body.match(/(?:開演|開場|START)[^\d]*(\d{1,2}:\d{2})/);
      events.push({ date, name: title, start: timeM?.[1] || '', end: '', demand: guessDemand(title, 14000) });
    }
    return events;
  } catch (_) { return []; }
}

// 国立競技場: 運営移管後の jns-e.com から取得
async function freeKokuritsu() {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const events = [];
  for (let mi = 0; mi < 4; mi++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mi, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
    try {
      const url = mi === 0 ? 'https://jns-e.com/event/' : `https://jns-e.com/event/page/${ym}/`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) continue;
      const html = await res.text();
      // 日付形式: 202607/01火 or 2026/07/01
      for (const m of html.matchAll(/(\d{4})(\d{2})\/(\d{2})[月火水木金土日]?/g)) {
        const date = `${m[1]}-${m[2]}-${m[3]}`;
        if (date < today) continue;
        // 前後のテキストからイベント名を取得
        const idx = m.index;
        const ctx = stripTags(html.slice(idx, idx + 300)).trim().replace(/\s+/g, ' ');
        const nameM = ctx.match(/[^\d\/月火水木金土日]{4,40}/);
        const name = nameM ? nameM[0].trim() : '国立競技場 イベント';
        if (!isValidEventName(name)) continue;
        events.push({ date, name, start: '', end: '', demand: guessDemand(name, 68000) });
      }
    } catch (_) {}
  }
  return events;
}

async function freeDome() {
  try {
    const res = await fetch('https://www.tokyo-dome.co.jp/dome/event/schedule.html', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const ldEvents = extractJsonLdEvents(html);
    if (ldEvents.length > 0) return ldEvents.filter(e => isValidEventName(e.name));
  } catch (_) {}
  return [];
}

async function freeSumo() {
  try {
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
        const d = new Date(start); d.setDate(d.getDate() + i);
        const date = d.toISOString().slice(0, 10);
        events.push({ date, name: '大相撲 東京場所', start: '8:00', end: '18:00頃', demand: i >= 12 ? 'high' : 'medium' });
      }
    }
    return events;
  } catch (_) { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=3600'); // 12時間キャッシュ

  const [
    rGiants, rSwallows, rDome, rKokugikan,
    rAriake, rToyota, rGarden, rBudokan, rBigsight, rYoyogi, rKokuritsu,
  ] = await Promise.allSettled([
    // 野球・相撲: 無料のみ（信頼性高）
    freeGiants(),
    freeSwallows(),
    // 東京ドーム: 無料 → AI
    fetchWithFallback(freeDome,
      ['https://www.tokyo-dome.co.jp/dome/event/schedule.html'],
      null, '東京ドーム', 55000),
    // 両国国技館: 無料のみ（大相撲スケジュール）
    freeSumo(),
    // 以下: 無料取得 → WP REST API → HTML → AI の順
    fetchWithFallback(() => Promise.resolve([]),
      ['https://ariake-arena.tokyo/event/', 'https://ariake-arena.tokyo/'],
      'ariake-arena.tokyo', '有明アリーナ', 15000),
    fetchWithFallback(() => Promise.resolve([]),
      ['https://www.toyota-arena-tokyo.jp/events/', 'https://www.toyota-arena-tokyo.jp/'],
      'www.toyota-arena-tokyo.jp', 'トヨタアリーナ東京', 10000),
    fetchWithFallback(() => Promise.resolve([]),
      ['https://www.shopping-sumitomo-rd.com/tokyo_garden_theater/schedule/?date=2026-07',
       'https://www.shopping-sumitomo-rd.com/tokyo_garden_theater/schedule/?date=2026-08',
       'https://www.shopping-sumitomo-rd.com/tokyo_garden_theater/schedule/?date=2026-09'],
      null, '東京ガーデンシアター', 8000),
    fetchWithFallback(freeBudokan,
      ['https://www.nipponbudokan.or.jp/schedule/', 'https://www.nipponbudokan.or.jp/'],
      'www.nipponbudokan.or.jp', '日本武道館', 14000),
    fetchWithFallback(() => Promise.resolve([]),
      ['https://www.bigsight.jp/visitor/event/'],
      'www.bigsight.jp', '東京ビッグサイト', 50000),
    fetchWithFallback(() => Promise.resolve([]),
      ['https://www.jpnsport.go.jp/yoyogi/event/tabid/59/default.aspx'],
      null, '代々木第一体育館', 13000),
    fetchWithFallback(freeKokuritsu,
      ['https://jns-e.com/event/'],
      null, '国立競技場', 68000),
  ]);

  const ok = r => r.status === 'fulfilled' ? r.value : [];
  const err = r => r.status === 'rejected' ? r.reason?.message : (r.value?.length === 0 ? 'empty' : null);

  return res.json({
    '東京ドーム':           ok(rDome).length ? ok(rDome) : ok(rGiants),
    '神宮球場':             ok(rSwallows),
    '両国国技館':           ok(rKokugikan),
    '有明アリーナ':         ok(rAriake),
    'トヨタアリーナ東京':   ok(rToyota),
    '東京ガーデンシアター': ok(rGarden),
    '日本武道館':           ok(rBudokan),
    '東京ビッグサイト':     ok(rBigsight),
    '代々木第一体育館':     ok(rYoyogi),
    '国立競技場':           ok(rKokuritsu),
    updatedAt: new Date().toISOString(),
    errors: {
      giants: err(rGiants), swallows: err(rSwallows), dome: err(rDome),
      kokugikan: err(rKokugikan), ariake: err(rAriake), toyota: err(rToyota), garden: err(rGarden),
      budokan: err(rBudokan), bigsight: err(rBigsight), yoyogi: err(rYoyogi), kokuritsu: err(rKokuritsu),
    },
  });
}
