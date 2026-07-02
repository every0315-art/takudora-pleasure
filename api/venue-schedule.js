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
  if (!res.ok) {
    console.error(`[venue-ai:${venueName}] Claude API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return [];
  }
  const data = await res.json();
  const content = data.content?.[0]?.text || '';
  const m = content.match(/\[[\s\S]*\]/);
  if (!m) {
    console.error(`[venue-ai:${venueName}] no JSON array found in response: ${content.slice(0, 300)}`);
    return [];
  }
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
    console.error(`[venue-ai:${venueName}] parsed ${events.length} raw events, ${result.length} after filtering`);
    return result;
  } catch (e) {
    console.error(`[venue-ai:${venueName}] JSON.parse failed: ${e.message} raw: ${m[0].slice(0, 300)}`);
    return [];
  }
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
    } catch (e) { console.error(`[venue-fallback:${venueName}] ${url} failed: ${e.message}`); }
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

// npb.jp/games/2026/ 専用パーサー（h6.date + score_table 形式）
function parseNpbPage(html, venueKeywords, teamName) {
  const events = [];
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  let year = new Date().getFullYear(), prevMonth = 0;
  for (const part of html.split('<h6 class="date">').slice(1)) {
    const dateM = part.match(/^(\d+)月(\d+)日/);
    if (!dateM) continue;
    const month = parseInt(dateM[1]), day = parseInt(dateM[2]);
    if (month < prevMonth && month <= 3) year++;
    prevMonth = month;
    const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if (date < today) continue;
    for (const tm of part.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
      const t = tm[1];
      const venueM = t.match(/<td class="state" colspan="5">\s*([^<]+?)\s*<\/td>/);
      if (!venueM) continue;
      const venue = venueM[1].replace(/\s+/g, '');
      if (!venueKeywords.some(k => venue.includes(k))) continue;
      if (seen.has(date)) continue;
      seen.add(date);
      const teams = [...t.matchAll(/alt="([^"]+?)"/g)].map(m => m[1]);
      const timeM = t.match(/<td class="state" colspan="3">\s*([\d:]+)/);
      const name = teams.length >= 2 ? `${teams[0].slice(0,4)} vs ${teams[1].slice(0,4)}` : `${teamName} 主催試合`;
      events.push({ date, name, start: timeM?.[1] || '18:00', end: `${(parseInt(timeM?.[1]||'18')+2)}:30頃`, demand: 'high' });
    }
  }
  return events;
}

// ── 各会場の無料取得関数 ──
// npb.jp/games/2026/schedule_MM_detail.html 専用パーサー（月別・全試合掲載）
// <tr id="dateMMDD">内に team1/team2/place/time が入る形式
function parseNpbMonthDetail(html, venueKeywords, teamName, year) {
  const events = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const m of html.matchAll(/<tr id="date(\d{4})"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const mmdd = m[1];
    const block = m[2];
    const team1 = block.match(/class="team1">([^<]*)</);
    const team2 = block.match(/class="team2">([^<]*)</);
    const place = block.match(/class="place">([^<]*)</);
    if (!team1 || !place) continue;
    const placeText = place[1].trim();
    if (!venueKeywords.some(k => placeText.includes(k))) continue;
    const date = `${year}-${mmdd.slice(0, 2)}-${mmdd.slice(2, 4)}`;
    if (date < today) continue;
    const timeM = block.match(/class="time">([^<]*)</);
    const start = timeM?.[1]?.trim() || '18:00';
    const t1 = team1[1].trim(), t2 = team2?.[1]?.trim() || '';
    const name = t1 && t2 ? `${t1} vs ${t2}` : `${teamName} 主催試合`;
    events.push({ date, name, start, end: `${parseInt(start) + 3}:00頃`, demand: 'high' });
  }
  return events;
}

async function freeGiants() {
  // npb.jp/games/{年}/ は直近1週間分しか出ないため、月別詳細ページ(当月+翌月+翌々月)を使う
  // 年またぎ(12月→1月)も自動対応
  const now = new Date();
  const events = [];
  for (let mi = 0; mi < 3; mi++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mi, 1);
    const year = d.getFullYear(), month = d.getMonth() + 1;
    try {
      const url = `https://npb.jp/games/${year}/schedule_${String(month).padStart(2, '0')}_detail.html`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) continue;
      events.push(...parseNpbMonthDetail(await res.text(), ['東京ドーム', '後楽'], '巨人', year));
    } catch (_) {}
  }
  if (events.length > 0) return events;
  // フォールバック: 直近1週間ページ
  try {
    const res = await fetch(`https://npb.jp/games/${now.getFullYear()}/`, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return [];
    const r = parseNpbPage(await res.text(), ['東京ドーム', '後楽'], '巨人');
    if (r.length > 0) return r;
  } catch (_) {}
  return [];
}

async function freeSwallows() {
  // ヤクルトサイトはカレンダーグリッド形式
  // href="/game/YYYYMM#day-YYYYMMDD" + c-calendar__day-stadium で神宮試合を特定
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const events = [];
  for (let mi = 0; mi < 3; mi++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mi, 1);
    const year = d.getFullYear(), month = d.getMonth() + 1;
    const ym = `${year}${String(month).padStart(2,'0')}`;
    try {
      const url = `https://www.yakult-swallows.co.jp/game?year=${year}&month=${month}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) continue;
      const html = await res.text();
      for (const m of html.matchAll(new RegExp(`href="/game/${ym}#day-(\\d{8})"[\\s\\S]{0,600}?c-calendar__day-stadium">([^<]+)`, 'g'))) {
        const ds = m[1], stadium = m[2].trim();
        if (!stadium.includes('神宮')) continue;
        const date = `${ds.slice(0,4)}-${ds.slice(4,6)}-${ds.slice(6,8)}`;
        if (date < today) continue;
        const block = html.slice(m.index, m.index + 600);
        const teamM = block.match(/alt="([^"]{2,8})"/);
        const timeM = block.match(/c-calendar__day-stats--time">\s*([\d:]+)/);
        const start = timeM?.[1] || '18:00';
        events.push({ date, name: `ヤクルト vs ${teamM?.[1] || '相手チーム'}`, start, end: `${parseInt(start)+2}:30頃`, demand: 'medium' });
      }
    } catch (_) {}
  }
  return events;
}

// 武道館: 公式サイトにコンサートスケジュールなし → Claude Haiku にまかせる（free関数なし）

// トヨタアリーナ東京: SSR Next.js、/events/ から取得
// <li class="bg-gray-f5..."> ブロック、テキスト "2026.M.D(曜) MAIN ARENA EVENT_NAME 開催時間：..."
async function freeToyota() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch('https://www.toyota-arena-tokyo.jp/events/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const events = [];
    for (const m of html.matchAll(/<li class="bg-gray[^>]*>([\s\S]*?)(?=<li class="bg-gray|<\/ul>)/gi)) {
      const block = m[1];
      const text = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const dateM = text.match(/2026\.(\d{1,2})\.(\d{1,2})/);
      if (!dateM) continue;
      const date = `2026-${dateM[1].padStart(2,'0')}-${dateM[2].padStart(2,'0')}`;
      if (date < today) continue;
      // イベント名: 日付・会場種別・開催時間・主催者・URLを除去
      const name = text
        .replace(/2026\.\d+\.\d+[（(][^）)]*[）)]\s*/g, '')
        .replace(/(?:MAIN|SUB)\s+ARENA\s*/gi, '')
        .replace(/開催時間[：:]\S+[\s\S]*/i, '')
        .replace(/主催者[\s\S]*/i, '')
        .replace(/https?:\/\/\S+/g, '')
        .trim().slice(0, 60);
      if (!isValidEventName(name)) continue;
      const timeM = text.match(/開催時間[：:](\d{1,2}:\d{2})/);
      events.push({ date, name, start: timeM?.[1] || '', end: '', demand: guessDemand(name, 10000) });
    }
    return events;
  } catch (_) { return []; }
}

// 東京ガーデンシアター: shopping-sumitomo-rd.com から取得
// テキスト形式: "07 03 Fri. [07 05 Sun.] コンサート・ショー EVENT_NAME"
async function freeGarden() {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const events = [];
  const DAYS = 'Mon|Tue|Wed|Thu|Fri|Sat|Sun';
  const re = new RegExp(
    `(\\d{2}) (\\d{2}) (?:${DAYS})\\. (?:(\\d{2}) (\\d{2}) (?:${DAYS})\\. )?` +
    `(?:コンサート[^\\s]*|展示[^\\s]*|スポーツ|その他) (.+?)(?= \\d{2} \\d{2} (?:${DAYS})\\.|$)`,
    'g'
  );
  for (let mi = 0; mi < 3; mi++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mi, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const year = d.getFullYear();
    try {
      const res = await fetch(`https://www.shopping-sumitomo-rd.com/tokyo_garden_theater/schedule/?date=${ym}`, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
                       .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      for (const m of text.matchAll(re)) {
        const date = `${year}-${m[1]}-${m[2]}`;
        const endDate = m[3] ? `${year}-${m[3]}-${m[4]}` : date;
        const name = m[5].trim().replace(/&#\d+;/g, '').trim().slice(0, 60);
        if (date < today || !isValidEventName(name)) continue;
        events.push({ date, endDate: endDate !== date ? endDate : undefined, name, start: '', end: '', demand: guessDemand(name, 8000) });
      }
    } catch (_) {}
  }
  return events;
}

// 国立競技場 (MUFGスタジアム): jns-e.com から取得
// テキスト形式: "カテゴリ EVENT_NAME 日程 2026 07/04 土 [2026 07/05 日] 開始時間 HH:MM"
async function freeKokuritsu() {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const events = [];
  const re = /(?:スポーツ|音楽|その他)\s+(.+?)\s+日程\s+(\d{4})\s+(\d{2})\/(\d{2})\s*[月火水木金土日]\s*(?:(\d{4})\s+(\d{2})\/(\d{2})\s*[月火水木金土日])?\s*(?:開始時間\s+([^\s主催]+))?/g;
  for (let mi = 0; mi < 4; mi++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mi, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
    try {
      const url = mi === 0 ? `https://jns-e.com/event/page/${ym}/` : `https://jns-e.com/event/page/${ym}/`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) continue;
      const html = await res.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
                       .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const name = m[1].replace(/&quot;/g, '"').trim().slice(0, 60);
        const date = `${m[2]}-${m[3]}-${m[4]}`;
        const endDate = m[5] ? `${m[5]}-${m[6]}-${m[7]}` : date;
        const startTime = m[8]?.match(/\d+:\d+/)?.[0] || '';
        if (date < today || !isValidEventName(name)) continue;
        events.push({ date, endDate: endDate !== date ? endDate : undefined, name, start: startTime, end: '', demand: guessDemand(name, 68000) });
      }
    } catch (_) {}
  }
  return events;
}

// 東京ドーム公式スケジュール: 野球+コンサート+イベント全部入りのカレンダーHTML
// "◯◯年◯月"見出し区間ごとに c-mod-calender__item(日別) → detail-in(イベント別) を解析
function parseTokyoDomeSchedule(html) {
  const events = [];
  const today = new Date().toISOString().slice(0, 10);
  const headings = [...html.matchAll(/(\d{4})年0?(\d{1,2})月/g)].map(m => ({ pos: m.index, year: Number(m[1]), month: Number(m[2]) }));
  for (let i = 0; i < headings.length; i++) {
    const { pos, year, month } = headings[i];
    const end = i + 1 < headings.length ? headings[i + 1].pos : html.length;
    const segment = html.slice(pos, end);
    for (const item of segment.matchAll(/<tr class="c-mod-calender__item">([\s\S]*?)<\/tr>/g)) {
      const block = item[1];
      const dayM = block.match(/c-mod-calender__day">(\d{1,2})</);
      if (!dayM) continue;
      const date = `${year}-${String(month).padStart(2, '0')}-${String(Number(dayM[1])).padStart(2, '0')}`;
      if (date < today) continue;
      for (const detail of block.matchAll(/<div class="c-mod-calender__detail-in">([\s\S]*?)<\/div><!-- \/c-mod-calender__detail-in -->/g)) {
        const db = detail[1];
        const nameM = db.match(/c-mod-calender__links">\s*<a[^>]*>([^<]*)<\/a>/);
        if (!nameM) continue;
        const name = nameM[1].trim();
        if (name === 'TOKYO DOME TOUR' || !isValidEventName(name)) continue;
        const timeText = db.match(/c-txt-caption-01">([^<]*)<\/p>/)?.[1]?.trim() || '';
        const startM = timeText.match(/(?:開演|開始)\s*([\d:]+)/) || timeText.match(/^([\d:]+)/);
        events.push({ date, name, start: startM?.[1] || '', end: '', demand: guessDemand(name, 55000) });
      }
    }
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
    const events = parseTokyoDomeSchedule(html);
    if (events.length > 0) return events;
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
    fetchWithFallback(freeToyota,
      ['https://www.toyota-arena-tokyo.jp/events/', 'https://www.toyota-arena-tokyo.jp/'],
      'www.toyota-arena-tokyo.jp', 'トヨタアリーナ東京', 10000),
    fetchWithFallback(freeGarden,
      ['https://www.shopping-sumitomo-rd.com/tokyo_garden_theater/schedule/'],
      null, '東京ガーデンシアター', 8000),
    fetchWithFallback(() => Promise.resolve([]),
      ['https://www.nipponbudokan.or.jp/houseplan/', 'https://www.nipponbudokan.or.jp/'],
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
