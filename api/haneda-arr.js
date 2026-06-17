// adsb.fi 無料 API で羽田空港周辺の到着便をリアルタイム取得
// FlightAware で発地・予定到着便を補完
// T1=JAL系, T2=ANA系, T3=国際線

const TERMINAL_MAP = {
  JAL: 1, JTA: 1, HAC: 1, RAC: 1, JJP: 1, JDH: 1, SKY: 1,
  ANA: 2, ADO: 2, SNA: 2, IBX: 2, SFJ: 2,
};

const DOMESTIC_PREFIXES = new Set(Object.keys(TERMINAL_MAP));

// ヘリ・小型機の type コードを除外
const EXCLUDED_TYPES = new Set([
  'A139','AW139','AS65','AS55','AS50','AS32','AS35','EC35','EC45','EC55',
  'EC15','EC30','H175','H160','H145','BK17','S76','S92','B407','B412',
  'B429','R44','R66','A109','AW09','AW19','C172','C152','C182','C206',
  'C208','C210','PA28','PA34','SR20','SR22','DA40','DA42','PC12',
]);

// T3 に表示する国際線旅客キャリアの ICAO プレフィックス
const INTL_CARRIERS = new Set([
  'KAL','AAR','CPA','CES','CCA','CAL','CSN','CSZ','HVN','VJC','PAL','MAS',
  'SIA','THA','BAW','AFR','DLH','KLM','SWR','IBE','AZA','FIN','SAS','UAE',
  'QTR','ETD','THY','SVA','GFA','UAL','DAL','AAL','ASA','HAL','ACA','AMX',
  'QFA','ANZ','EK','EY','TK','LH','AF','KE','OZ','MU','CZ','CA','CI','BR',
  'NH','JL','VN','PR','MH','SQ','TG','FJ','GA','AI','9W','6E','XY','RJ',
  'AM','NZ','AC','AS','HA','AA','UA','DL','BA','VS','LX','OS','SK','AY',
  'OAE','OAL','OMA','ITY',
]);

// IATA コード → 日本語都市名
const IATA_JP = {
  // 国内
  CTS:'札幌', OKD:'札幌(丘珠)', HKD:'函館', AOJ:'青森', SDJ:'仙台', AXT:'秋田',
  SYO:'庄内', FKS:'福島', KIJ:'新潟', RIC:'松本', NGO:'名古屋', ITM:'大阪(伊丹)',
  KIX:'大阪(関空)', UKB:'神戸', OKJ:'岡山', HIJ:'広島', TKS:'徳島', MYJ:'松山',
  KCZ:'高知', FUK:'福岡', NGS:'長崎', KMJ:'熊本', OIT:'大分', KMI:'宮崎',
  KOJ:'鹿児島', ISG:'石垣', MMY:'宮古島', OKA:'那覇',
  IWK:'岩国', KMQ:'小松', TOY:'富山', FSZ:'静岡', OKI:'隠岐', TTJ:'鳥取',
  IWJ:'石見', TSJ:'対馬', FUJ:'福江', OBO:'帯広', AKJ:'旭川',
  MMB:'女満別', SHB:'中標津', KUH:'釧路', WKJ:'稚内', RIS:'利尻',
  KKJ:'北九州', TAK:'高松', GAJ:'山形', SHM:'白浜', UBJ:'山口宇部', TKO:'徳之島',
  // 国際
  HKG:'香港', ICN:'ソウル', GMP:'ソウル(金浦)', PEK:'北京', PKX:'北京(大興)',
  PVG:'上海(浦東)', SHA:'上海(虹橋)', CAN:'広州', CTU:'成都', XIY:'西安',
  TPE:'台北', KHH:'高雄', MFM:'マカオ', SIN:'シンガポール', KUL:'クアラルンプール',
  BKK:'バンコク', DMK:'バンコク(ドンムアン)', CGK:'ジャカルタ', MNL:'マニラ',
  SGN:'ホーチミン', HAN:'ハノイ', RGN:'ヤンゴン', DEL:'ニューデリー', BOM:'ムンバイ',
  DXB:'ドバイ', AUH:'アブダビ', DOH:'ドーハ', CDG:'パリ', LHR:'ロンドン',
  FRA:'フランクフルト', AMS:'アムステルダム', ZRH:'チューリッヒ', FCO:'ローマ',
  MAD:'マドリード', IST:'イスタンブール', SVO:'モスクワ', LAX:'ロサンゼルス',
  JFK:'ニューヨーク', ORD:'シカゴ', SFO:'サンフランシスコ', SEA:'シアトル',
  YVR:'バンクーバー', YYZ:'トロント', MEX:'メキシコシティ', GRU:'サンパウロ',
  SYD:'シドニー', MEL:'メルボルン', AKL:'オークランド',
  IAD:'ワシントン', IAH:'ヒューストン', ORD:'シカゴ',
};

// "10:26a" → JST の Unix ms (UTC)
function parseJstTime(str, Y, M, D, nowMs) {
  const m = str.match(/^(\d{1,2}):(\d{2})([ap])$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3] === 'a') { if (h === 12) h = 0; }
  else              { if (h !== 12) h += 12; }
  // JST=UTC+9 なので UTC に変換
  let utc = Date.UTC(Y, M, D, h - 9, min);
  if (utc - nowMs < -12 * 3600000) utc += 86400000; // 翌日補正
  if (utc - nowMs >  18 * 3600000) utc -= 86400000; // 前日補正（安全）
  return utc;
}

// FlightAware で発地と到着時刻を取得
async function fetchFlightInfo(callsign) {
  try {
    const r = await fetch(
      `https://www.flightaware.com/live/flight/${encodeURIComponent(callsign)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!r.ok) return { origin: null, arrStr: null };
    const html = await r.text();

    // 発地
    const block = html.match(/"origin":\s*\{([^}]{0,400})\}/)?.[1] || '';
    const iata  = block.match(/"iata":"([^"]+)"/)?.[1] || '';
    const loc   = block.match(/"friendlyLocation":"([^"]+)"/)?.[1] || '';
    const origin = (!iata || iata === 'HND' || iata === 'RJTT')
      ? null
      : (IATA_JP[iata] || loc.replace(/, Japan$/, '') || iata);

    // 到着時刻 epoch — actualArrivalTime > estimatedArrivalTime > gateArrivalTime の優先順
    let arrStr = null;
    const epochM = html.match(/"actualArrivalTime":\{"epoch":(\d+)/)
                || html.match(/"estimatedArrivalTime":\{"epoch":(\d+)/)
                || html.match(/"gateArrivalTime":\{"epoch":(\d+)/);
    if (epochM) {
      const ms = parseInt(epochM[1], 10) * 1000;
      const jst = new Date(ms + 9 * 3600000);
      let h = jst.getUTCHours();
      const min = String(jst.getUTCMinutes()).padStart(2, '0');
      const ap = h < 12 ? 'a' : 'p';
      if (h === 0) h = 12; else if (h > 12) h -= 12;
      arrStr = `${h}:${min}${ap}`;
    }

    return { origin, arrStr };
  } catch { return { origin: null, arrStr: null }; }
}

// FlightAware RJTT enroute-board から今後1時間以内の予定到着便を取得
async function fetchScheduledArrivals() {
  try {
    const r = await fetch('https://www.flightaware.com/live/airport/RJTT', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { 1: [], 2: [], 3: [] };
    const html = await r.text();

    // enroute-board セクションを抽出
    const start = html.indexOf('id="enroute-board"');
    if (start < 0) return { 1: [], 2: [], 3: [] };
    // 次のボードセクションまで
    let end = html.length;
    for (const m of html.matchAll(/id="(arrivals|departures|scheduled)-board"/g)) {
      if (m.index > start) { end = m.index; break; }
    }
    const chunk = html.substring(start, end);

    const now = Date.now();
    const jstNow = new Date(now + 9 * 3600000);
    const Y = jstNow.getUTCFullYear(), M = jstNow.getUTCMonth(), D = jstNow.getUTCDate();

    const flights = [];
    for (const rowM of chunk.matchAll(/<tr[^>]+id="Row_[^"]*"[\s\S]*?<\/tr>/g)) {
      const row = rowM[0];

      // 便名
      const callM = row.match(/\/live\/flight\/([A-Z0-9]+)"/);
      const call = callM?.[1] || '';
      if (!call) continue;

      const prefix = call.match(/^([A-Z]+)/)?.[1] || '';
      const isDomestic = DOMESTIC_PREFIXES.has(prefix);
      if (!isDomestic && !INTL_CARRIERS.has(prefix)) continue;

      // 機種
      const typeM = row.match(/\/live\/aircrafttype\/([A-Z0-9]+)"/);
      const type = typeM?.[1] || '';

      // 発地 IATA — 複数パターンで取得を試みる
      const origM = row.match(/itemprop="url">([A-Z]{3,4})<\/a>/)
                 || row.match(/\/airport\/([A-Z]{3,4})"/)
                 || row.match(/airport\/([A-Z]{3,4})/);
      const origIata = origM?.[1] || '';

      // HND 到着時刻（JST）— 行内の最後の JST タイムスタンプ
      const jstTimes = [...row.matchAll(/(\d{1,2}:\d{2}[ap])&nbsp;<span class="tz">JST<\/span>/g)];
      if (!jstTimes.length) continue;
      const arrStr = jstTimes[jstTimes.length - 1][1];

      const arrMs = parseJstTime(arrStr, Y, M, D, now);
      if (!arrMs) continue;

      const diff = arrMs - now;
      // 5分前〜60分後の便のみ
      if (diff < -5 * 60000 || diff > 60 * 60000) continue;

      const terminal = TERMINAL_MAP[prefix] || 3;
      flights.push({
        flight: call,
        type,
        origin: IATA_JP[origIata] || (origIata && origIata !== 'HND' && origIata !== 'RJTT' ? origIata : null),
        arrStr,
        arrMs,
        terminal,
      });
    }

    flights.sort((a, b) => a.arrMs - b.arrMs);

    const byTerminal = { 1: [], 2: [], 3: [] };
    for (const f of flights) {
      const t = f.terminal <= 2 ? f.terminal : 3;
      byTerminal[t].push({ flight: f.flight, type: f.type, origin: f.origin, arrStr: f.arrStr });
    }
    return byTerminal;
  } catch {
    return { 1: [], 2: [], 3: [] };
  }
}

export default async function handler(req, res) {
  try {
    // ADS-B と FlightAware を並列取得
    const [adsbRes, scheduled] = await Promise.all([
      fetch(
        'https://opendata.adsb.fi/api/v2/lat/35.5494/lon/139.7798/dist/40',
        {
          headers: { 'User-Agent': 'TakudoraPleasure/1.0' },
          signal: AbortSignal.timeout(8000),
        }
      ),
      fetchScheduledArrivals(),
    ]);

    if (!adsbRes.ok) throw new Error(`adsb.fi ${adsbRes.status}`);
    const data = await adsbRes.json();
    const aircraft = data.aircraft || [];

    const candidates = [];
    for (const a of aircraft) {
      const call = (a.flight || '').trim();
      if (!call || call.length < 3) continue;
      if (a.category === 'C2' || a.category === 'C1') continue;
      if ((a.dbFlags || 0) & 1) continue;
      if (a.t && EXCLUDED_TYPES.has(a.t)) continue;
      if (a.category === 'A2' || a.category === 'B1' || a.category === 'B2') continue;

      const prefix = call.match(/^([A-Z]+)/)?.[1] || '';
      if (!prefix || prefix.length < 2) continue;

      const isDomestic = DOMESTIC_PREFIXES.has(prefix);
      if (!isDomestic && !INTL_CARRIERS.has(prefix)) continue;

      const isGround = a.alt_baro === 'ground';
      const alt = isGround ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : 99999);
      const dst = a.dst || 0;

      const isApproaching = !isGround && alt <= 5000 && dst <= 40;
      const isLanded      = isGround && dst <= 2;
      if (!isApproaching && !isLanded) continue;

      const terminal = TERMINAL_MAP[prefix] || 3;
      candidates.push({
        flight:     call,
        type:       a.t || '',
        terminal,
        status:     isLanded ? '着陸済' : `進入中 ${alt.toLocaleString()}ft`,
        statusCode: isLanded ? 'landed' : 'approach',
        alt,
        dst: Math.round(dst * 10) / 10,
      });
    }

    // scheduled の便名→到着時刻・発地マップを作成
    const schedMap = {};
    for (const t of [1, 2, 3]) {
      for (const f of scheduled[t] || []) {
        schedMap[f.flight] = { arrStr: f.arrStr, origin: f.origin };
      }
    }

    // 発地・到着時刻を並列取得（最大8件）— scheduled にある便はそちらを優先
    const enriched = await Promise.all(
      candidates.slice(0, 8).map(async f => {
        const sched = schedMap[f.flight];
        if (sched?.origin && sched?.arrStr) {
          return { ...f, origin: sched.origin, arrStr: sched.arrStr };
        }
        const info = await fetchFlightInfo(f.flight);
        return { ...f, origin: sched?.origin || info.origin, arrStr: sched?.arrStr || info.arrStr };
      })
    );

    const byTerminal = { 1: [], 2: [], 3: [] };
    for (const f of enriched) {
      byTerminal[f.terminal <= 2 ? f.terminal : 3].push(f);
    }
    for (const t of [1, 2, 3]) {
      byTerminal[t].sort((a, b) => a.alt - b.alt);
    }

    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      terminals: byTerminal,
      scheduled,
      total: enriched.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(502).json({ error: e.message, terminals: { 1: [], 2: [], 3: [] }, scheduled: { 1: [], 2: [], 3: [] }, total: 0 });
  }
}
