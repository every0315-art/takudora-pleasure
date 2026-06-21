// 日報画像をClaude AIで読み取り、売上データを抽出する

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { image, mediaType, corrections } = req.body || {};
  if (!image) return res.status(400).json({ error: 'No image provided' });

  const FIELD_LABELS = { date:'日付', sales:'売上', trips:'営業回数', distance:'全走', tax:'税金', departure:'出庫時間', arrival:'入庫時間' };
  let correctionsSection = '';
  if (corrections && corrections.length > 0) {
    // 同じパターンの訂正頻度を集計
    const freqMap = {};
    for (const c of corrections) {
      for (const d of c.diffs) {
        const key = `${d.field}:${d.ocr ?? ''}→${d.correct ?? ''}`;
        freqMap[key] = (freqMap[key] || { field: d.field, ocr: d.ocr, correct: d.correct, count: 0 });
        freqMap[key].count++;
      }
    }
    const sorted = Object.values(freqMap).sort((a, b) => b.count - a.count);
    if (sorted.length > 0) {
      const lines = sorted.map(d => {
        const label = FIELD_LABELS[d.field] || d.field;
        const freq = d.count > 1 ? `（${d.count}回同じ間違い）` : '';
        return `- ${label}: 「${d.ocr ?? '未読'}」→正しくは「${d.correct ?? '未入力'}」${freq}`;
      });
      correctionsSection = `\n\n【過去の訂正履歴・最優先で参照してください】\nこの日報書式でAIが繰り返し誤読したパターンです。必ず修正して返してください：\n${lines.join('\n')}`;
    }
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image },
          },
          {
            type: 'text',
            text: `これはタクシー乗務員の日報です。以下の項目を読み取ってJSONで返してください。
項目が読み取れない場合はnullにしてください。
数値はカンマ・単位を除いた数値のみ返してください。
小数点は正確に読んでください。例：237.7→237.7（2377にしない）、123.4km→123.4。
時刻はHH:MM形式で返してください。時・分を両方必ず読み取ってください。例：8時15分→"08:15"、13時05分→"13:05"。
日付はYYYY-MM-DD形式で返してください。

【売上（sales）の読み方】
「総営収」の値を読んでください。「税抜営収」「実収」「基本料金合計」などは使わないでください。
「総営収」が見つからない場合は「営業収入」「売上合計」「合計金額」を探してください。

【税金（tax）の読み方】
「税収」「消費税」「税金」の値を読んでください。
「税抜営収」ではなく消費税額そのものです。

【営業回数（trips）の読み方】
集計表に「入庫」「出庫」「差引」の3行がある場合、必ず「差引」行の「計数」列の値を読んでください。
「差引」行が見つからない場合は「営業回数」「乗車回数」「賃走回数」「実車回数」「合計」欄を探してください。
「入庫」行や「出庫」行の計数（4000〜5000など大きい数）は絶対に使わないでください。
通常10〜30回程度の小さい数値です。

【全走行距離（distance）の読み方】
集計表に「入庫」「出庫」「差引」の3行がある場合、必ず「差引」行の「全走km」列の値を読んでください。
小数点を含む場合（例：237.7）は小数点まで正確に読んでください。2377のように繋げて読まないこと。
ページ下部のメーター差（走行距離240など整数）ではなく、集計表の差引行の値を優先してください。
通常100〜400km程度の数値です。

{
  "date": 日付（YYYY-MM-DD）,
  "sales": 売上金額（円）,
  "trips": 営業回数（回）,
  "distance": 全走行距離（km）,
  "tax": 税金・消費税（円）,
  "departure": 出庫時間（HH:MM）,
  "arrival": 入庫時間（HH:MM）
}

JSONのみ返してください。説明不要。${correctionsSection}`,
          },
        ],
      }],
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    return res.status(502).json({ error: `Claude API error: ${r.status}`, detail: err });
  }

  const data = await r.json();
  const text = data.content?.[0]?.text || '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] || text);
    return res.json({ ok: true, data: parsed });
  } catch {
    return res.json({ ok: false, raw: text, error: 'Parse failed' });
  }
}
