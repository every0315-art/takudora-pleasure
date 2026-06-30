// ?mode=health → スクレイパー死活監視（health.jsを統合）
// それ以外 → 天気情報

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const ALERT_TO = 'every0315@gmail.com';

const HEALTH_CHECKS = [
  { name: 'ogasawara', label: '小笠原海運',              url: 'https://www.ogasawarakaiun.co.jp/service/',      validate: h => h.includes('東京着') },
  { name: 'taxiAssoc', label: '東京ハイヤー・タクシー協会', url: 'https://www.taxi-tokyo.or.jp/',                  validate: h => h.includes('home-info') },
  { name: 'tokyoTC',   label: '東京タクシーセンター',      url: 'https://www.tokyo-tc.or.jp/news/',               validate: h => h.includes('news-list') },
  { name: 'yahooTransit', label: 'Yahoo!乗換（鉄道遅延）', url: 'https://transit.yahoo.co.jp/diainfo/area/4',    validate: h => h.includes('__NEXT_DATA__') },
  { name: 'cruiseMag', label: '客船カレンダー',            url: 'https://www.cruise-mag.com/arrival-calendar/',  validate: h => h.length > 5000 },
];

async function checkSource({ name, label, url, validate }) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { name, label, ok: false, error: `HTTP ${r.status}` };
    const html = await r.text();
    const valid = validate(html);
    return { name, label, ok: valid, error: valid ? null : 'HTML構造が変わった可能性あり' };
  } catch (e) {
    return { name, label, ok: false, error: e.message };
  }
}

async function sendAlertEmail(failed, resendKey) {
  const rows = failed.map(f => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">${f.label}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#c0392b;">${f.error || '不明'}</td></tr>`).join('');
  const jstNow = new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 16);
  const html = `<div style="font-family:sans-serif;max-width:560px;">
    <h2 style="color:#c0392b;">⚠ タクドラPLEASURE スクレイパー異常</h2>
    <p>チェック日時: ${jstNow} JST</p>
    <p>以下のデータソースで取得エラーが発生しました。サイトのHTML構造が変わった可能性があります。</p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      <thead><tr style="background:#f5f5f5;"><th style="padding:6px 12px;text-align:left;">ソース</th><th style="padding:6px 12px;text-align:left;">エラー</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:16px;font-size:12px;color:#888;">確認URL: <a href="https://pleasure.delivery-every.com/api/weather?mode=health">https://pleasure.delivery-every.com/api/weather?mode=health</a></p>
  </div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
    body: JSON.stringify({ from: 'タクドラPLEASURE <onboarding@resend.dev>', to: [ALERT_TO], subject: `⚠ スクレイパー異常 ${failed.length}件 — タクドラPLEASURE`, html }),
  });
  if (!r.ok) console.error('[health] resend error:', r.status, await r.text());
  else console.log('[health] alert email sent');
}

async function handleHealth(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1';
  const token = process.env.HEALTH_TOKEN;
  const isAutomated = isCron || (token && req.headers['x-health-token'] === token);
  res.setHeader('Cache-Control', isAutomated ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=60');

  const results = await Promise.all(HEALTH_CHECKS.map(checkSource));
  const sources = Object.fromEntries(results.map(r => [r.name, { label: r.label, ok: r.ok, error: r.error }]));
  const failed = results.filter(r => !r.ok);
  const allOk = failed.length === 0;

  console.log(`[health] ${allOk ? 'ALL OK' : `${failed.length}/${results.length} FAILED: ${failed.map(f => f.name).join(', ')}`}`);

  const resendKey = process.env.RESEND_API_KEY;
  if (isAutomated && !allOk && resendKey) {
    await sendAlertEmail(failed, resendKey).catch(e => console.error('[health] email error:', e.message));
  }

  res.status(allOk ? 200 : 207).json({ ok: allOk, checkedAt: new Date().toISOString(), sources });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.query?.mode === 'health') return handleHealth(req, res);

  const apiKey = process.env.OPENWEATHER_API_KEY;
  const city = 'Tokyo';
  const lang = 'ja';

  try {
    const [currentRes, forecastRes] = await Promise.all([
      fetch(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=${lang}`),
      fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric&lang=${lang}&cnt=8`)
    ]);

    const current = await currentRes.json();
    const forecast = await forecastRes.json();

    const temp = Math.round(current.main.temp);
    const desc = current.weather[0].description;
    const icon = current.weather[0].icon;
    const rain = current.rain ? current.rain['1h'] || 0 : 0;

    const weatherId = current.weather[0].id;
    let demand = 'やや低め';
    if (weatherId < 600) demand = '高い';
    else if (weatherId < 800) demand = 'やや高め';
    else demand = 'やや低め';

    const nowSec = Date.now() / 1000;
    const hours = [3, 6, 9, 12].map(h => {
      const target = nowSec + h * 3600;
      const item = forecast.list.reduce((a, b) =>
        Math.abs(b.dt - target) < Math.abs(a.dt - target) ? b : a
      );
      return {
        time: String(new Date(item.dt * 1000).getHours()).padStart(2,'0') + ':00',
        label: `${new Date(item.dt * 1000 + 9 * 3600000).getUTCHours()}時〜`,
        icon: item.weather[0].icon,
        temp: Math.round(item.main.temp),
        isRain: item.weather[0].id < 700,
        rain: item.rain ? (item.rain['3h'] || 0) : 0,
      };
    });

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=120');
    res.json({ temp, desc, icon, rain, demand, hours });
  } catch (e) {
    res.status(500).json({ error: 'weather fetch failed' });
  }
}
