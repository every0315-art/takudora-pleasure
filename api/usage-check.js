// 毎日9時JST実行: Vercel関数呼び出し数を確認し80%超えたらSupabaseにアラート保存
// 必要な環境変数: VERCEL_TOKEN (vercel.com/account/tokens で作成)

export const config = { maxDuration: 30 };

const SUPABASE_URL = 'https://wfbxkhjpgquyfnqlwbwy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmYnhraGpwZ3F1eWZucWx3Ynd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxOTYxNDgsImV4cCI6MjA2NDc3MjE0OH0.nFNUkqFpkt98UmgdBenBxG7vRBtJZw-pUuM1f0kByTY';
const VERCEL_HOBBY_LIMIT = 100000; // Hobbyプランの月間関数実行上限
const ALERT_THRESHOLD = 0.8;

async function saveAlert(data) {
  await fetch(`${SUPABASE_URL}/rest/v1/user_data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key: 'usage_alert', value: JSON.stringify(data) }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    await saveAlert({ error: 'VERCEL_TOKEN未設定', checkedAt: new Date().toISOString() });
    return res.status(200).json({ ok: false, reason: 'VERCEL_TOKEN not set' });
  }

  try {
    const projectId = process.env.VERCEL_PROJECT_ID;
    const teamId = process.env.VERCEL_ORG_ID;

    // 今月初のUNIXタイムスタンプ(ms)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const params = new URLSearchParams({ from: monthStart, to: Date.now(), granularity: 'month' });
    if (teamId) params.set('teamId', teamId);

    const usageRes = await fetch(
      `https://api.vercel.com/v2/projects/${projectId}/metrics?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    let invocations = null;
    if (usageRes.ok) {
      const data = await usageRes.json();
      // Vercel APIのレスポンス形式に応じて取得
      invocations = data?.data?.invocations ?? data?.invocations ?? data?.total ?? null;
    }

    // APIから取得できない場合はビルド数ベースで推定
    if (invocations === null) {
      const buildsRes = await fetch(
        `https://api.vercel.com/v6/deployments?projectId=${projectId}&since=${monthStart}&limit=1${teamId ? `&teamId=${teamId}` : ''}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (buildsRes.ok) {
        // 取得できた場合は概算（デプロイ数ではなく関数実行数の代替なし → 不明とする）
        invocations = -1; // 不明
      }
    }

    const pct = invocations > 0 ? invocations / VERCEL_HOBBY_LIMIT : null;
    const alert = pct !== null && pct >= ALERT_THRESHOLD;

    const alertData = {
      invocations,
      limit: VERCEL_HOBBY_LIMIT,
      pct: pct !== null ? Math.round(pct * 100) : null,
      alert,
      checkedAt: new Date().toISOString(),
      monthStart: new Date(monthStart).toISOString(),
    };

    await saveAlert(alertData);
    return res.status(200).json({ ok: true, ...alertData });

  } catch (e) {
    await saveAlert({ error: e.message, checkedAt: new Date().toISOString() });
    return res.status(500).json({ error: e.message });
  }
}
