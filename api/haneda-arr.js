// 羽田空港到着便
// FlightAware enroute-board → 便名・発地・到着時刻（1リクエスト）
// ADS-B (adsb.fi)          → 状態バッジ付与のみ

const TERMINAL_MAP = {
  JAL: 1, JTA: 1, HAC: 1, RAC: 1, JJP: 1, JDH: 1, SKY: 1,
  ANA: 2, ADO: 2, SNA: 2, IBX: 2, SFJ: 2,
};
const DOMESTIC_PREFIXES = new Set(Object.keys(TERMINAL_MAP));

const EXCLUDED_TYPES = new Set([
  'A139','AW139','AS65','AS55','AS50','AS32','AS35','EC35','EC45','EC55',
  'EC15','EC30','H175','H160','H145','BK17','S76','S92','B407','B412',
  'B429','R44','R66','A109','AW09','AW19','C172','C152','C182','C206',
  'C208','C210','PA28','PA34','SR20','SR22','DA40','DA42','PC12',
]);

const INTL_CARRIERS = new Set([
  'KAL','AAR','CPA','CES','CCA','CAL','CSN','CSZ','HVN','VJC','PAL','MAS',
  'SIA','THA','BAW','AFR','DLH','KLM','SWR','IBE','AZA','FIN','SAS','UAE',
  'QTR','ETD','THY','SVA','GFA','UAL','DAL','AAL','ASA','HAL','ACA','AMX',
  'QFA','ANZ','EK','EY','TK','LH','AF','KE','OZ','MU','CZ','CA','CI','BR',
  'NH','JL','VN','PR','MH','SQ','TG','FJ','GA','AI','9W','6E','XY','RJ',
  'AM','NZ','AC','AS','HA','AA','UA','DL','BA','VS','LX','OS','SK','AY',
  'OAE','OAL','OMA','ITY',
]);

const IATA_JP = {
  CTS:'札幌', OKD:'札幌(丘珠)', HKD:'函館', AOJ:'青森', SDJ:'仙台', AXT:'秋田',
  SYO:'庄内', FKS:'福島', KIJ:'新潟', RIC:'松本', NGO:'名古屋', ITM:'大阪(伊丹)',
  KIX:'大阪(関空)', UKB:'神戸', OKJ:'岡山', HIJ:'広島', TKS:'徳島', MYJ:'松山',
  KCZ:'高知', FUK:'福岡', NGS:'長崎', KMJ:'熊本', OIT:'大分', KMI:'宮崎',
  KOJ:'鹿児島', ISG:'石垣', MMY:'宮古島', OKA:'那覇',
  IWK:'岩国', KMQ:'小松', TOY:'富山', FSZ:'静岡', OKI:'隠岐', TTJ:'鳥取',
  IWJ:'石見', TSJ:'対馬', FUJ:'福江', OBO:'帯広', AKJ:'旭川',
  MMB:'女満別', SHB:'中標津', KUH:'釧路', WKJ:'稚内', RIS:'利尻',
  KKJ:'北九州', TAK:'高松', GAJ:'山形', SHM:'白浜', UBJ:'山口宇部', TKO:'徳之島',
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
  IAD:'ワシントン', IAH:'ヒューストン',
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// "10:26a" (FlightAware JST形式) → UTC ms
function parseJstTime(str, Y, M, D, nowMs) {
  const m = str.match(/^(\d{1,2}):(\d{2})([ap])$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3] === 'a') { if (h === 12) h = 0; }
  else              { if (h !== 12) h += 12; }
  let utc = Date.UTC(Y, M, D, h - 9, min);
  if (utc - nowMs < -12 * 3600000) utc += 86400000;
  if (utc - nowMs >  18 * 3600000) utc -= 86400000;
  return utc;
}

// FlightAware RJTT enroute-board から到着便リストを取得
async function fetchEnrouteArrivals() {
  const r = await fetch('https://www.flightaware.com/live/airport/RJTT', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`FlightAware ${r.status}`);
  const html = await r.text();

  const start = html.indexOf('id="enroute-board"');
  if (start < 0) return [];
  let end = html.length;
  for (const m of html.matchAll(/id="(?:arrivals|departures|scheduled)-board"/g)) {
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
    if (!DOMESTIC_PREFIXES.has(prefix) && !INTL_CARRIERS.has(prefix)) continue;

    // 機種（ヘリ等除外）
    const typeM = row.match(/\/live\/aircrafttype\/([A-Z0-9]+)"/);
    const type = typeM?.[1] || '';
    if (type && EXCLUDED_TYPES.has(type)) continue;

    // 発地 IATA — href から優先取得（テキストより安定）
    const origM = row.match(/\/live\/airport\/([A-Z]{3,4})"/)
               || row.match(/\/airports\/([A-Z]{3,4})"/)
               || row.match(/itemprop="url">([A-Z]{3,4})<\/a>/);
    const origIata = (origM?.[1] || '').toUpperCase();
    const origin = (origIata && origIata !== 'HND' && origIata !== 'RJTT')
      ? (IATA_JP[origIata] || origIata)
      : null;

    // 到着時刻（行内の最後の JST タイムスタンプ）
    const jstTimes = [...row.matchAll(/(\d{1,2}:\d{2}[ap])&nbsp;<span class="tz">JST<\/span>/g)];
    if (!jstTimes.length) continue;
    const arrStr = jstTimes[jstTimes.length - 1][1];
    const arrMs = parseJstTime(arrStr, Y, M, D, now);
    if (!arrMs) continue;

    // -30分〜+60分以内のみ
    const diff = arrMs - now;
    if (diff < -30 * 60000 || diff > 60 * 60000) continue;

    flights.push({
      flight: call,
      type,
      origin,
      arrStr,
      arrMs,
      terminal: TERMINAL_MAP[prefix] || 3,
    });
  }

  flights.sort((a, b) => a.arrMs - b.arrMs);
  return flights;
}

// FlightAware 個別フライトページから到着時刻を取得（arrStr が取れなかった便の補完用）
async function fetchArrTime(callsign) {
  try {
    const r = await fetch(
      `https://www.flightaware.com/live/flight/${encodeURIComponent(callsign)}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const html = await r.text();
    // 実績→推定→ゲート の優先順で epoch を探す
    const m = html.match(/"actualArrivalTime":\{"epoch":(\d+)/)
           || html.match(/"estimatedArrivalTime":\{"epoch":(\d+)/)
           || html.match(/"gateArrivalTime":\{"epoch":(\d+)/);
    if (!m) return null;
    const jst = new Date(parseInt(m[1], 10) * 1000 + 9 * 3600000);
    let h = jst.getUTCHours();
    const min = String(jst.getUTCMinutes()).padStart(2, '0');
    const ap = h < 12 ? 'a' : 'p';
    if (h === 0) h = 12; else if (h > 12) h -= 12;
    return `${h}:${min}${ap}`;
  } catch { return null; }
}

// ADS-B で現在の進入中・着陸済便を取得（状態バッジ用）
async function fetchAdsbStatus() {
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

    const prefix = call.match(/^([A-Z]+)/)?.[1] || '';
    if (prefix.length < 2) continue;
    if (!DOMESTIC_PREFIXES.has(prefix) && !INTL_CARRIERS.has(prefix)) continue;

    const isGround = a.alt_baro === 'ground';
    const alt = isGround ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : 99999);
    const dst = a.dst || 0;

    const isLanded    = isGround && dst <= 2;
    const isApproach  = !isGround && alt <= 5000 && dst <= 40;
    if (!isLanded && !isApproach) continue;

    map[call] = {
      status:     isLanded ? '着陸済' : `進入中 ${alt.toLocaleString()}ft`,
      statusCode: isLanded ? 'landed' : 'approach',
    };
  }
  return map;
}

export default async function handler(req, res) {
  try {
    const [enroute, adsbMap] = await Promise.all([
      fetchEnrouteArrivals().catch(() => []),
      fetchAdsbStatus().catch(() => ({})),
    ]);

    // enroute 便に ADS-B ステータスを付与
    const enrouteSet = new Set(enroute.map(f => f.flight));
    const merged = enroute.map(f => ({
      ...f,
      ...(adsbMap[f.flight] || { status: '予定', statusCode: 'scheduled' }),
    }));

    // ADS-B のみにある便（着陸済で enroute-board から消えた便など）を追加
    for (const [call, st] of Object.entries(adsbMap)) {
      if (enrouteSet.has(call)) continue;
      const prefix = call.match(/^([A-Z]+)/)?.[1] || '';
      const terminal = TERMINAL_MAP[prefix] || 3;
      merged.push({
        flight: call, type: '', origin: null, arrStr: null,
        arrMs: st.statusCode === 'landed' ? Date.now() - 1 : Date.now() + 2 * 60000,
        terminal, ...st,
      });
    }

    // arrStr が null の便（ADS-B のみ）に個別ページで到着時刻を補完（最大4件）
    const nowMs2 = Date.now();
    const jn = new Date(nowMs2 + 9 * 3600000);
    const [Y2, M2, D2] = [jn.getUTCFullYear(), jn.getUTCMonth(), jn.getUTCDate()];
    await Promise.all(
      merged.filter(f => !f.arrStr).slice(0, 4).map(async f => {
        const t = await fetchArrTime(f.flight);
        if (t) {
          f.arrStr = t;
          f.arrMs = parseJstTime(t, Y2, M2, D2, nowMs2) || f.arrMs;
        }
      })
    );

    merged.sort((a, b) => a.arrMs - b.arrMs);

    const byTerminal = { 1: [], 2: [], 3: [] };
    for (const f of merged) {
      byTerminal[f.terminal <= 2 ? f.terminal : 3].push(f);
    }

    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ terminals: byTerminal, total: merged.length, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: e.message, terminals: { 1:[], 2:[], 3:[] }, total: 0 });
  }
}
