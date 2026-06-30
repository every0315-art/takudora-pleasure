// 主要スクレイパーの死活監視エンドポイント
// /api/health でアクセス可能。Vercel Cronから毎日8時に実行。
// 異常検知時は RESEND_API_KEY が設定されていればメール通知。

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const ALERT_TO = 'every0315@gmail.com';

const CHECKS = [
  {
    name: 'ogasawara',
    label: '小笠原海運',
    url: 'https://www.ogasawarakaiun.co.jp/service/',
    validate: html => html.includes('東京着'),
  },
  {
    name: 'taxiAssoc',
    label: '東京ハイヤー・タクシー協会',
    url: 'https://www.taxi-tokyo.or.jp/',
    validate: html => html.includes('home-info'),
  },
  {
    name: 'tokyoTC',
    label: '東京タクシーセンター',
    url: 'https://www.tokyo-tc.or.jp/news/',
    validate: html => html.includes('news-list'),
  },
  {
    name: 'yahooTransit',
    label: 'Yahoo!乗換（鉄道遅延）',
    url: 'https://transit.yahoo.co.jp/diainfo/area/4',
    validate: html => html.includes('__NEXT_DATA__'),
  },
  {
    name: 'cruiseMag',
    label: '客船カレンダー',
    url: 'https://www.cruise-mag.com/arrival-calendar/',
    validate: html => html.length > 5000,
  },
];

async function checkSource({ name, label, url, validate }) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { name, label, ok: false, error: `HTTP ${r.status}` };
    const html = await r.text();
    const valid = validate(html);
    return { name, label, ok: valid, error: valid ? null : 'HTML構造が変わった可能性あり' };
  } catch (e) {
    return { name, label, ok: false, error: e.message };
  }
}

async function sendAlertEmail(failed, resendKey) {
  const rows = failed.map(f => `<tr>
    <td style="padding:6px 12px;border-bottom:1px solid #eee;">${f.label}</td>
    <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#c0392b;">${f.error || '不明'}</td>
  </tr>`).join('');

  const jstNow = new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 16);

  const html = `<div style="font-family:sans-serif;max-width:560px;">
    <h2 style="color:#c0392b;">⚠ タクドラPLEASURE スクレイパー異常</h2>
    <p>チェック日時: ${jstNow} JST</p>
    <p>以下のデータソースで取得エラーが発生しました。サイトのHTML構造が変わった可能性があります。</p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:6px 12px;text-align:left;">ソース</th>
          <th style="padding:6px 12px;text-align:left;">エラー</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:16px;font-size:12px;color:#888;">
      確認URL: <a href="https://pleasure.delivery-every.com/api/health">https://pleasure.delivery-every.com/api/health</a>
    </p>
  </div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: 'タクドラPLEASURE <onboarding@resend.dev>',
      to: [ALERT_TO],
      subject: `⚠ スクレイパー異常 ${failed.length}件 — タクドラPLEASURE`,
      html,
    }),
  });

  if (!r.ok) {
    const body = await r.text();
    console.error('[health] resend error:', r.status, body);
  } else {
    console.log('[health] alert email sent');
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // cronからのアクセスはキャッシュしない、手動アクセスは5分キャッシュ
  const isCron = req.headers['x-vercel-cron'] === '1';
  res.setHeader('Cache-Control', isCron ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=60');

  const results = await Promise.all(CHECKS.map(checkSource));

  const sources = {};
  for (const r of results) sources[r.name] = { label: r.label, ok: r.ok, error: r.error };

  const failed = results.filter(r => !r.ok);
  const allOk = failed.length === 0;

  console.log(`[health] ${allOk ? 'ALL OK' : `${failed.length}/${results.length} FAILED: ${failed.map(f => f.name).join(', ')}`}`);

  // cronからのアクセスかつ異常あり → メール送信
  const resendKey = process.env.RESEND_API_KEY;
  if (isCron && !allOk && resendKey) {
    await sendAlertEmail(failed, resendKey).catch(e => console.error('[health] email error:', e.message));
  }

  res.status(allOk ? 200 : 207).json({
    ok: allOk,
    checkedAt: new Date().toISOString(),
    sources,
  });
}
