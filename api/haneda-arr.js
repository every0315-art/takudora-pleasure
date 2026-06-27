// 羽田空港到着便
// 羽田空港公式API (tokyo-haneda.com) → 便名・発地・到着時刻・ターミナル・出口番号
// ADS-B (adsb.fi)                    → 進入中ステータス補完

const HANEDA_API = 'https://tokyo-haneda.com/app/api/v2/flight/search';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// "HH:MM" (JST) → UTC ms
function parseHanedaTime(str, Y, M, D, nowMs) {
  const m = str && str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  let utc = Date.UTC(Y, M, D, h - 9, min);
  if (utc - nowMs < -12 * 3600000) utc += 86400000;
  if (utc - nowMs >  18 * 3600000) utc -= 86400000;
  return utc;
}

async function fetchHanedaFlights(flightType, searchDt) {
  const r = await fetch(HANEDA_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Referer': 'https://tokyo-haneda.com/flight/dms_search.html',
    },
    body: JSON.stringify({
      flightType,
      arrivalType: 2,
      searchDt,
      airportCodes: [],
      airlineCodes: [],
      flightNumber: '',
      status: [0],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Haneda API ${r.status}`);
  const data = await r.json();
  return data.flightlists || [];
}

const EXCLUDED_TYPES = new Set([
  'A139','AW139','AS65','AS55','AS50','AS32','AS35','EC35','EC45','EC55',
  'EC15','EC30','H175','H160','H145','BK17','S76','S92','B407','B412',
  'B429','R44','R66','A109','AW09','AW19','C172','C152','C182','C206',
  'C208','C210','PA28','PA34','SR20','SR22','DA40','DA42','PC12',
]);

async function fetchAdsbApproach() {
  const r = await fetch(
    'https://opendata.adsb.fi/api/v2/lat/35.5494/lon/139.7798/dist/40',
    { headers: { 'User-Agent': 'TakudoraPleasure/1.0' }, signal: AbortSignal.timeout(8000) }
  );
  if (!r.ok) return {};
  const { aircraft = [] } = await r.json();

  const map = {};
  for (const a of aircraft) {
    const call = (a.flight || '').trim();
    if (!call || call.length < 3) continue;
    if ((a.dbFlags || 0) & 1) continue;
    if (a.t && EXCLUDED_TYPES.has(a.t)) continue;
    if (['C1','C2','A2','B1','B2'].includes(a.category)) continue;

    const isGround = a.alt_baro === 'ground';
    const alt = isGround ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : 99999);
    const dst = a.dst || 0;

    if (!isGround && alt <= 5000 && dst <= 40) {
      map[call] = `進入中 ${alt.toLocaleString()}ft`;
    }
  }
  return map;
}

export default async function handler(req, res) {
  try {
    const pastMin  = Math.min(180, Math.max(0, parseInt(req.query?.past  ?? '30', 10) || 30));
    const futureMin = Math.min(180, Math.max(0, parseInt(req.query?.future ?? '60', 10) || 60));
    const now = Date.now();
    const jstNow = new Date(now + 9 * 3600000);
    const Y = jstNow.getUTCFullYear(), M = jstNow.getUTCMonth(), D = jstNow.getUTCDate();
    const searchDt = `${Y}${String(M + 1).padStart(2,'0')}${String(D).padStart(2,'0')}`;

    const [[domesticList, intlList], approachMap] = await Promise.all([
      Promise.all([
        fetchHanedaFlights(1, searchDt).catch(() => []),
        fetchHanedaFlights(2, searchDt).catch(() => []),
      ]),
      fetchAdsbApproach().catch(() => ({})),
    ]);

    const result = [];
    const seen = new Set();

    for (const f of [...domesticList, ...intlList]) {
      const airline = f.airlines?.[0];
      if (!airline) continue;
      const flightNum = airline.flightNumber || '';
      if (!flightNum || seen.has(flightNum)) continue;
      seen.add(flightNum);

      // 到着時刻（change_time が "-" なら on_time）
      const timeStr = (f.change_time && f.change_time !== '-') ? f.change_time : f.on_time;
      if (!timeStr || timeStr === '-') continue;

      const arrMs = parseHanedaTime(timeStr, Y, M, D, now);
      if (!arrMs) continue;

      const diff = arrMs - now;
      if (diff < -pastMin * 60000 || diff > futureMin * 60000) continue;

      const tStr = f.terminal?.terminal || '';
      const terminal = tStr === 'T1' ? 1 : tStr === 'T2' ? 2 : 3;

      // 出口番号（国内線のみ付く）
      const exitGateOpt = f.options?.find(o => o.type === 'exitGate');
      const exitGates = exitGateOpt?.items?.map(i => i.name).join('・') || null;

      // ステータス（ADS-B進入中 > 公式API）
      let status, statusCode;
      if (approachMap[flightNum]) {
        status = approachMap[flightNum];
        statusCode = 'approach';
      } else if (f.status?.category === 'arrived') {
        const minSince = (now - arrMs) / 60000;
        const baggageMin = f.flightType === 'international' ? 45 : 25;
        if (minSince >= 0 && minSince <= baggageMin) {
          status = '手荷物中';
          statusCode = 'baggage';
        } else {
          status = '到着済み';
          statusCode = 'landed';
        }
      } else if (f.status?.category === 'canceled') {
        status = '欠航';
        statusCode = 'canceled';
      } else if (f.status?.category === 'delayed') {
        status = '遅延';
        statusCode = 'delayed';
      } else {
        status = '予定';
        statusCode = 'scheduled';
      }

      const onTime = (f.on_time && f.on_time !== '-') ? f.on_time : null;
      result.push({ flight: flightNum, origin: f.area_name || null, arrStr: timeStr, onTime, arrMs, terminal, exitGates, intl: f.flightType === 'international', status, statusCode });
    }

    result.sort((a, b) => a.arrMs - b.arrMs);

    const byTerminal = { 1: [], 2: [], 3: [] };
    for (const f of result) byTerminal[f.terminal <= 2 ? f.terminal : 3].push(f);

    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ terminals: byTerminal, total: result.length, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: e.message, terminals: { 1:[], 2:[], 3:[] }, total: 0 });
  }
}
