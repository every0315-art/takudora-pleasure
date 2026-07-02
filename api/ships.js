// 客船入港スケジュール自動取得
// 1. 小笠原海運 → 竹芝着をパース
// 2. 大型客船（有明・晴海）→ Claude Haikuでページ解析
// CDNキャッシュ 12時間

export const config = { maxDuration: 45 };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// 小笠原海運ページをHTMLテーブルパースして竹芝着を返す
async function fetchOgasawara() {
  try {
    const r = await fetch('https://www.ogasawarakaiun.co.jp/service/', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const html = await r.text();

    const nowJst = new Date(Date.now() + 9 * 3600000);
    const baseYear = nowJst.getUTCFullYear();
    const baseMonth = nowJst.getUTCMonth() + 1; // 1-12

    // タブの月順序を取得: ['6','7','8',...,'12','1',...,'5']
    const tabMonths = [...html.matchAll(/>(\d{1,2})月</g)].map(m => parseInt(m[1]));
    // 重複除去・1〜12の範囲のものだけ
    const monthOrder = [...new Set(tabMonths)].filter(m => m >= 1 && m <= 12);

    // 東京着列を持つ時刻表テーブルを全て抽出（4つおきにある）
    const allTables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
    const schedTables = allTables.filter(t => t.includes('東京着'));

    const results = [];

    schedTables.forEach((tableHtml, tableIdx) => {
      const month = monthOrder[tableIdx];
      if (!month) return;

      // 年の決定: 今月より前の月番号は来年
      let year = baseYear;
      if (month < baseMonth) year = baseYear + 1;
      // 12月と1月の境界: 現在が12月なら1〜5月は来年
      if (baseMonth === 12 && month <= 6) year = baseYear + 1;

      // 行を解析（日付は<th>、時刻は<td>）
      const rowMatches = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
      for (const rowM of rowMatches) {
        const rowHtml = rowM[0];

        // 日付セル（<th>）
        const thMatch = rowHtml.match(/<th[\s\S]*?<\/th>/i);
        if (!thMatch) continue;
        const thText = thMatch[0].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
        const dayMatch = thText.match(/^(\d{1,2})/);
        if (!dayMatch) continue;
        const day = parseInt(dayMatch[1]);

        // 時刻セル（<td>）: [東京発, 父島着, 父島発, 東京着]
        const cells = [...rowHtml.matchAll(/<td[\s\S]*?<\/td>/gi)].map(c =>
          c[0].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim()
        );
        if (cells.length < 4) continue;

        // 東京着の時刻（cells[3]）- <strong>タグ除去後の"HH:MM"を抽出
        const timeMatch = cells[3].match(/\d{1,2}:\d{2}/);
        if (!timeMatch) continue;
        const tokyoArrival = timeMatch[0];

        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        results.push({
          date: dateStr,
          name: 'おがさわら丸（父島→竹芝）',
          arrival: tokyoArrival,
          departure: '',
          terminal: '竹芝客船ターミナル',
          sourceUrl: 'https://www.ogasawarakaiun.co.jp/service/',
        });
      }
    });

    console.log(`[ships] ogasawara parsed: ${results.length} arrivals`);
    return { items: results, ok: true };
  } catch (e) {
    console.error('[ships] ogasawara error:', e.message);
    return { items: [], ok: false, error: e.message };
  }
}

// 大型客船スケジュールをClaudeで解析
async function fetchLargeShipsViaClaude(apiKey) {
  const sources = [
    {
      url: 'https://www.cruise-mag.com/arrival-calendar/',
      label: 'WEB CRUISE 客船入港カレンダー（全国）',
    },
    {
      url: 'https://www.tptc.co.jp/terminal/guide/cruise',
      label: '東京国際クルーズターミナル（有明）お知らせページ',
    },
    {
      url: 'https://www.tptc.co.jp/terminal/guide/harumi',
      label: '晴海客船ターミナルお知らせページ',
    },
  ];

  const texts = [];
  for (const src of sources) {
    try {
      const r = await fetch(src.url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) continue;
      const html = await r.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\s　]+/g, ' ')
        .slice(0, 8000);
      texts.push(`【${src.label}】\n${text}`);
    } catch (e) {
      console.error('[ships] fetch error:', src.url, e.message);
    }
  }

  if (texts.length === 0) return [];

  const nowJst = new Date(Date.now() + 9 * 3600000);
  const todayStr = nowJst.toISOString().slice(0, 10);

  const prompt = `以下は客船入港カレンダーおよび東京港クルーズターミナルのウェブページのテキストです。
今日は${todayStr}です。

【抽出条件】
- 東京港（有明・晴海・東京国際クルーズターミナル）に入港する客船のみ抽出
- 竹芝は小笠原海運で別途取得するため除外
- 今日以降のスケジュールを優先（過去の情報も含めてよい）

返答形式（JSON配列のみ、説明不要）:
[
  {
    "date": "YYYY-MM-DD",
    "name": "船名",
    "arrival": "HH:MM または空文字",
    "departure": "HH:MM または空文字",
    "terminal": "東京国際クルーズターミナル（有明）または晴海ふ頭客船ターミナル"
  }
]

情報がなければ空配列 [] を返してください。

ページテキスト:
${texts.join('\n\n')}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!r.ok) throw new Error(`Claude ${r.status}`);
    const data = await r.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { items: [], ok: false, error: 'Claude returned no JSON' };
    const items = JSON.parse(jsonMatch[0]).map(it => ({
      ...it,
      sourceUrl: (it.terminal || '').includes('晴海')
        ? 'https://www.tptc.co.jp/terminal/guide/harumi'
        : 'https://www.tptc.co.jp/terminal/guide/cruise',
    }));
    return { items, ok: true };
  } catch (e) {
    console.error('[ships] claude error:', e.message);
    return { items: [], ok: false, error: e.message };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=3600');

  const apiKey = process.env.ANTHROPIC_API_KEY;

  try {
    const [ogasawaraResult, largeResult] = await Promise.all([
      fetchOgasawara(),
      apiKey ? fetchLargeShipsViaClaude(apiKey) : Promise.resolve({ items: [], ok: true }),
    ]);

    const all = [...ogasawaraResult.items, ...largeResult.items];

    // 重複除去（同日・同船名）
    const seen = new Set();
    const unique = all.filter(s => {
      const key = `${s.date}|${s.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 日付順ソート
    unique.sort((a, b) => a.date.localeCompare(b.date));

    const _sourceErrors = {};
    if (!ogasawaraResult.ok) _sourceErrors.ogasawara = ogasawaraResult.error;
    if (!largeResult.ok) _sourceErrors.largeshipsAI = largeResult.error;

    console.log(`[ships] fetched: ogasawara=${ogasawaraResult.items.length}, large=${largeResult.items.length}`);
    res.json({ ships: unique, updatedAt: new Date().toISOString(), _sourceErrors });
  } catch (e) {
    res.status(502).json({ error: e.message, ships: [], _sourceErrors: { fatal: e.message } });
  }
}
