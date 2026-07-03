// 全会場スケジュール自動取得
// 無料スクレーピング優先、取れない場合のみ Claude Haiku にフォールバック
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT = 12000;

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// "18:30" + 135分 → "20:45" のように分の繰り上がりを正しく処理して終演予想時刻を作る
function addMinutesToTime(start, minutes) {
  const [h, m] = start.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${hh}:${String(mm).padStart(2, '0')}頃`;
}

function decodeEntities(text) {
  return text
    .replace(/&(?:ldquo|rdquo);/g, '"')
    .replace(/&(?:lsquo|rsquo);/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
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
        const end = endD && !isNaN(endD) ? `${String(endD.getHours()).padStart(2,'0')}:${String(endD.getMinutes()).padStart(2,'0')}頃` : '21:00';
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
      // 開催中(開始日は過去でも終了日が未来)のイベントも表示するため、
      // 開始日ではなく終了日で足切りする
      const endDate = e.endDate || e.date;
      if (endDate >= today) {
        result.push({ date: e.date, endDate, name: e.name, start: e.start || '', end: e.end || '21:00', demand: guessDemand(e.name, capacity) });
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
        events.push({ date: dateStr, name, start: timeM ? timeM[1] : '', end: '21:00', demand: guessDemand(name, capacity) });
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
    // 球場名は表示上「神　宮」のように全角スペース区切りで入る場合があるため除去してから比較
    const placeText = place[1].replace(/[\s　]/g, '');
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

// npb.jpは全球団・全球場の試合を掲載しているため、球団別にサイトを分けず
// 会場キーワードで絞り込む共通関数にまとめる(球団サイトごとの個別スクレイピングは不要)
async function fetchNpbVenueGames(venueKeywords, teamName) {
  const now = new Date();
  const events = [];
  for (let mi = 0; mi < 3; mi++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mi, 1);
    const year = d.getFullYear(), month = d.getMonth() + 1;
    try {
      const url = `https://npb.jp/games/${year}/schedule_${String(month).padStart(2, '0')}_detail.html`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) continue;
      events.push(...parseNpbMonthDetail(await res.text(), venueKeywords, teamName, year));
    } catch (_) {}
  }
  if (events.length > 0) return events;
  // フォールバック: 直近1週間ページ
  try {
    const res = await fetch(`https://npb.jp/games/${now.getFullYear()}/`, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return [];
    const r = parseNpbPage(await res.text(), venueKeywords, teamName);
    if (r.length > 0) return r;
  } catch (_) {}
  return [];
}

async function freeGiants() {
  return fetchNpbVenueGames(['東京ドーム', '後楽'], '巨人');
}

// 神宮球場: プロ野球以外に東京六大学/東都大学野球・高校野球・コンサート等も
// 開催されるため、公式サイトのJSON API(全カテゴリ網羅)を使う
// data.json構造: [ [{blogCategory,year,yearData:[{month,monthData:[{day,dayData:[{time,category,value:[{team1,team2}]}]}]}]}], ... ] の3グループ
async function freeJingu() {
  try {
    const res = await fetch('https://www.jingu-stadium.com/event/json/data.json', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    const nowYear = new Date().getFullYear();
    const events = [];
    for (const group of data) {
      for (const bc of group) {
        if (bc.year < nowYear) continue;
        for (const md of bc.yearData || []) {
          for (const dd of md.monthData || []) {
            for (const item of dd.dayData || []) {
              const date = `${bc.year}-${String(md.month).padStart(2, '0')}-${String(dd.day).padStart(2, '0')}`;
              if (date < today) continue;
              const category = (item.category || '').trim();
              if (!category) continue;
              // プロ野球はteam1/team2が<img alt="チーム名">形式、大学野球等はプレーンテキストのため両対応
              const teamName = t => {
                const altM = (t || '').match(/alt=['"]([^'"]+)['"]/);
                return altM ? altM[1].trim() : stripTags(t || '');
              };
              // プロ野球は東京ドームと同じ「チームAーチームB」形式、それ以外はカテゴリ名を残す
              const isProBaseball = category === 'プロ野球';
              const matches = (item.value || [])
                .filter(v => !v.cancel)
                .map(v => isProBaseball
                  ? `${teamName(v.team1)}ー${teamName(v.team2)}`
                  : `${teamName(v.team1)} vs ${teamName(v.team2)}`)
                .filter(s => s !== 'ー' && s !== ' vs ');
              const name = matches.length === 0 ? category
                : isProBaseball ? matches.join('／')
                : `${category}：${matches.join('／')}`;
              if (!isValidEventName(name)) continue;
              const demand = /プロ野球|高等学校野球選手権|都市対抗/.test(category) ? 'high' : 'medium';
              const start = item.time || '';
              // 野球系は試合時間が概ね3時間程度で終演予想を計算、それ以外は不明なため21時で統一
              const isBaseball = /野球/.test(category);
              const end = (isBaseball && start) ? `${parseInt(start, 10) + 3}:${start.split(':')[1]}頃` : '21:00';
              events.push({ date, name, start, end, demand });
            }
          }
        }
      }
    }
    return events;
  } catch (_) { return []; }
}

async function freeSwallows() {
  return freeJingu();
}

// 武道館: 公式サイトにスケジュールなし → enjoy-live.net(ライブ会場スケジュールまとめサイト)を使用
// <article class="calendar" id="YYYY-M"> ごとに月が分かれ、<tr><th class="date">D日(曜)</th><td><strong><a>アーティスト</a></strong><span>タイトル</span>...</td></tr>
// ※このソースは開演時間の情報を持たないため start/end は空のまま(コンサートは公演ごとに時間が異なり推測不可)
async function freeBudokan() {
  try {
    const res = await fetch('https://schedule.enjoy-live.net/schedule.php?hall_id=3', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const today = new Date().toISOString().slice(0, 10);
    const events = [];
    for (const art of html.matchAll(/<article class="calendar" id="(\d{4})-(\d{1,2})">([\s\S]*?)<\/article>/g)) {
      const year = Number(art[1]), month = Number(art[2]);
      for (const row of art[3].matchAll(/<tr>\s*<th class="date">(\d{1,2})日\([^)]*\)<\/th>([\s\S]*?)<\/tr>/g)) {
        const day = Number(row[1]);
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (date < today) continue;
        for (const m of row[2].matchAll(/<strong><a[^>]*>([^<]*)<\/a><\/strong><span>([^<]*)<\/span>/g)) {
          const artist = decodeEntities(m[1]).trim();
          const title = decodeEntities(m[2]).trim();
          const name = title ? `${artist} ${title}` : artist;
          if (!isValidEventName(name)) continue;
          events.push({ date, name, start: '', end: '21:00', demand: guessDemand(name, 14000) });
        }
      }
    }
    if (events.length > 0) return events;
  } catch (_) {}
  return [];
}

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
      const start = timeM?.[1] || '';
      // コンサート/ライブ会場のため開演の2時間15分後を終演予想とする(開演不明時は21時で統一)
      events.push({ date, name, start, end: start ? addMinutesToTime(start, 135) : '21:00', demand: guessDemand(name, 10000) });
    }
    return events;
  } catch (_) { return []; }
}

// 東京ガーデンシアター: shopping-sumitomo-rd.com から取得
// 一覧ページ(<li class="event_all">...</li>)で日付/名前を取得し、
// 各イベントの詳細ページ(【開場】HH:MM【開演】HH:MM)から開演時刻を取得する
async function freeGarden() {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const items = [];
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
      for (const li of html.matchAll(/<li class="event_all[^"]*"><a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/li>/g)) {
        const href = li[1];
        const block = li[2];
        const ymds = [...block.matchAll(/<div class="m">(\d{2})<\/div>\s*<div class="d">(\d{2})<\/div>/g)];
        if (ymds.length === 0) continue;
        const date = `${year}-${ymds[0][1]}-${ymds[0][2]}`;
        const endDate = ymds.length > 1 ? `${year}-${ymds[1][1]}-${ymds[1][2]}` : date;
        if (endDate < today) continue;
        const player = decodeEntities(stripTags(block.match(/<div class="player"[^>]*>([\s\S]*?)<\/div>/)?.[1] || ''));
        const title = decodeEntities(stripTags(block.match(/<div class="title"[^>]*>([\s\S]*?)<\/div>/)?.[1] || ''));
        const name = (player ? `${player} ${title}` : title).trim().slice(0, 60);
        if (!isValidEventName(name)) continue;
        items.push({ date, endDate: endDate !== date ? endDate : undefined, name, href });
      }
    } catch (_) {}
  }
  // 詳細ページから開演時刻を並行取得
  const details = await Promise.allSettled(items.map(it =>
    fetch(it.href, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) })
      .then(r => r.ok ? r.text() : '')
      .then(html => html.match(/【開演】\s*(\d{1,2}:\d{2})/)?.[1] || '')
  ));
  return items.map((it, i) => {
    const start = details[i].status === 'fulfilled' ? details[i].value : '';
    // コンサート・ショー会場のため開演の2時間15分後を終演予想とする(開演不明時は21時で統一)
    const end = start ? addMinutesToTime(start, 135) : '21:00';
    return { date: it.date, endDate: it.endDate, name: it.name, start, end, demand: guessDemand(it.name, 8000) };
  });
}

// 国立競技場 (MUFGスタジアム): jns-e.com から取得
// テキスト形式: "カテゴリ EVENT_NAME 日程 2026 07/04 土 [2026 07/05 日] 開始時間 HH:MM"
async function freeKokuritsu() {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const events = [];
  const re = /(スポーツ|音楽|その他)\s+(.+?)\s+日程\s+(\d{4})\s+(\d{2})\/(\d{2})\s*[月火水木金土日]\s*(?:(\d{4})\s+(\d{2})\/(\d{2})\s*[月火水木金土日])?\s*(?:開始時間\s+([^\s主催]+))?/g;
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
        const category = m[1];
        const name = m[2].replace(/&quot;/g, '"').trim().slice(0, 60);
        const date = `${m[3]}-${m[4]}-${m[5]}`;
        const endDate = m[6] ? `${m[6]}-${m[7]}-${m[8]}` : date;
        const startTime = m[9]?.match(/\d+:\d+/)?.[0] || '';
        if (date < today || !isValidEventName(name)) continue;
        // 音楽(コンサート)は開演の2時間15分後を終演予想とする。スポーツ等は所要時間が読めないため空
        const end = (category === '音楽' && startTime) ? addMinutesToTime(startTime, 135) : '21:00';
        events.push({ date, endDate: endDate !== date ? endDate : undefined, name, start: startTime, end, demand: guessDemand(name, 68000) });
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
        const start = startM?.[1] || '';
        const tag = db.match(/c-txt-tag__item[^"]*">([^<]*)</)?.[1] || '';
        // 野球は試合時間が概ね3時間、コンサートは開演の2時間15分後を終演予想とする
        const end = start ? (tag.includes('野球') ? `${parseInt(start, 10) + 3}:${start.split(':')[1]}頃` : addMinutesToTime(start, 135)) : '21:00';
        events.push({ date, name, start, end, demand: guessDemand(name, 55000) });
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

// 両国国技館: 日本相撲協会「年間日程表」(令和年表記)から東京場所(国技館開催)の初日を取得
// <table class="mdTable4 type3"> の各行: 場所名/会場/前売り開始日/番付発表/初日/千秋楽
// 東京ビッグサイト: kaboot.net(展示会カレンダーまとめサイト)の月別ページ
// JSON-LD ItemList > itemListElement[].item(Event) で構造化されている
async function freeBigsight() {
  const now = new Date();
  const events = [];
  for (let mi = 0; mi < 4; mi++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mi, 1);
    const year = d.getFullYear(), month = d.getMonth() + 1;
    try {
      const url = `https://kaboot.net/exhibition_calendar/summary/${year}-${String(month).padStart(2, '0')}-bigsight.php`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) continue;
      const html = await res.text();
      for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        let data;
        try { data = JSON.parse(block[1]); } catch (_) { continue; }
        if (data['@type'] !== 'ItemList' || !Array.isArray(data.itemListElement)) continue;
        for (const li of data.itemListElement) {
          const ev = li.item;
          if (!ev || ev['@type'] !== 'Event' || !ev.name || !ev.startDate) continue;
          // kaboot.netのJSON-LDは時間情報を持たないため、展示会の一般的な開催時間(10:00-17:00)を仮定
          events.push({ date: ev.startDate, endDate: ev.endDate || ev.startDate, name: ev.name, start: '10:00', end: '17:00', demand: guessDemand(ev.name, 50000) });
        }
      }
    } catch (_) {}
  }
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  return events.filter(e => {
    if ((e.endDate || e.date) < today) return false;
    const key = `${e.date}|${e.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return isValidEventName(e.name);
  });
}

async function freeSumo() {
  try {
    const res = await fetch('https://www.sumo.or.jp/Admission/schedule/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const today = new Date().toISOString().slice(0, 10);
    const events = [];
    for (const table of html.matchAll(/<table class="mdTable4 type3">([\s\S]*?)<\/table>/g)) {
      for (const row of table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
        const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => stripTags(c[1]));
        if (cells.length < 6) continue;
        if (!cells[1].includes('国技館')) continue;
        const m = cells[4].match(/令和(\d+)年\s*(\d{1,2})\/(\d{1,2})/);
        if (!m) continue;
        const year = Number(m[1]) + 2018;
        const start = `${year}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
        for (let i = 0; i < 15; i++) {
          const d = new Date(start); d.setDate(d.getDate() + i);
          const date = d.toISOString().slice(0, 10);
          if (date < today) continue;
          events.push({ date, name: '大相撲 東京場所', start: '8:00', end: '18:00頃', demand: i >= 12 ? 'high' : 'medium' });
        }
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
    fetchWithFallback(freeBudokan,
      ['https://www.nipponbudokan.or.jp/'],
      'www.nipponbudokan.or.jp', '日本武道館', 14000),
    fetchWithFallback(freeBigsight,
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
