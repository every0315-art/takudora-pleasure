// adsb.fi 無料 API を使って羽田空港周辺の到着便をリアルタイム取得
// T1=JAL系, T2=ANA系, T3=国際線

const TERMINAL_MAP = {
  // T1: JAL グループ
  JAL: 1, JTA: 1, HAC: 1, RAC: 1, JJP: 1, JDH: 1, SKY: 1,
  // T2: ANA グループ
  ANA: 2, ADO: 2, SNA: 2, IBX: 2, SFJ: 2,
};

const AIRLINE_NAME = {
  JAL: 'JAL', JTA: 'JTA', HAC: 'HAC', RAC: 'RAC琉球', JJP: 'Jetstar',
  JDH: 'J-Air', SKY: 'スカイマーク',
  ANA: 'ANA', ADO: 'AIR DO', SNA: 'Solaseed', IBX: 'IBEX', SFJ: 'Starflyer',
};

// 国内主要キャリア以外は国際線扱い
const DOMESTIC_PREFIXES = new Set(Object.keys(TERMINAL_MAP));

export default async function handler(req, res) {
  try {
    // 羽田空港中心 35.5494N 139.7798E, 40nm 圏内
    const r = await fetch(
      'https://opendata.adsb.fi/api/v2/lat/35.5494/lon/139.7798/dist/40',
      {
        headers: { 'User-Agent': 'TakudoraPleasure/1.0' },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!r.ok) throw new Error(`adsb.fi ${r.status}`);
    const data = await r.json();
    const aircraft = data.aircraft || [];

    const results = [];
    for (const a of aircraft) {
      const call = (a.flight || '').trim();
      if (!call || call.length < 3) continue;
      // 地上車両・ヘリ以外
      if (a.category === 'C2' || a.category === 'C1') continue;
      // 軍用
      if ((a.dbFlags || 0) & 1) continue;

      const prefix = call.match(/^([A-Z]+)/)?.[1] || '';
      if (!prefix || prefix.length < 2) continue;

      const isGround = a.alt_baro === 'ground';
      const alt = isGround ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : 99999);
      const gs  = Math.round(a.gs || 0);
      const dst = a.dst || 0;

      // 進入中: 高度5000ft以下 かつ 空港40nm圏内
      // 着陸済: 地上 かつ 空港2nm以内
      const isApproaching = !isGround && alt <= 5000 && dst <= 40;
      const isLanded      = isGround && dst <= 2;

      if (!isApproaching && !isLanded) continue;

      const terminal = TERMINAL_MAP[prefix] || (DOMESTIC_PREFIXES.has(prefix) ? 1 : 3);
      const isDomestic = DOMESTIC_PREFIXES.has(prefix);

      results.push({
        flight:   call,
        type:     a.t || '',
        airline:  AIRLINE_NAME[prefix] || call.replace(/\d+/, ''),
        terminal,
        isDomestic,
        status:   isLanded ? '着陸済' : `進入中 ${alt.toLocaleString()}ft`,
        statusCode: isLanded ? 'landed' : 'approach',
        alt,
        gs,
        dst: Math.round(dst * 10) / 10,
      });
    }

    // ターミナル別に整理、altitude 昇順（低い＝より近い）
    const byTerminal = { 1: [], 2: [], 3: [] };
    for (const f of results) {
      const t = f.terminal === 1 ? 1 : f.terminal === 2 ? 2 : 3;
      byTerminal[t].push(f);
    }
    for (const t of [1, 2, 3]) {
      byTerminal[t].sort((a, b) => a.alt - b.alt);
    }

    res.setHeader('Cache-Control', 's-maxage=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      terminals: byTerminal,
      total: results.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(502).json({ error: e.message, terminals: { 1: [], 2: [], 3: [] }, total: 0 });
  }
}
