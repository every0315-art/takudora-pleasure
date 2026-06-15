export default async function handler(req, res) {
  try {
    const year = new Date().getFullYear();
    const url = `https://www.city.yokohama.lg.jp/kanko-bunka/minato/kyakusen/nyuko/${year}.html`;
    const html = await (await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' }
    })).text();

    const ships = [];
    let currentMonth = 0;

    // 月見出しとテーブル行を順番に処理
    const tokens = html.split(/(<h[23][^>]*>[\s\S]*?<\/h[23]>|<tr[\s\S]*?<\/tr>)/i);
    for (const tok of tokens) {
      // 月見出し: "1月" "6月" など
      const mh = tok.match(/<h[23][^>]*>[\s\S]*?(\d{1,2})月[\s\S]*?<\/h[23]>/i);
      if (mh) { currentMonth = parseInt(mh[1]); continue; }

      if (!tok.includes('<tr') || !currentMonth) continue;
      const cells = [...tok.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
      if (cells.length < 4) continue;

      // 入港日時セル: "6日(土) 6:30" or "6日（土）6:30"
      const dayMatch = cells[0].match(/(\d{1,2})日/);
      const timeMatch = cells[0].match(/(\d{1,2}:\d{2})/);
      if (!dayMatch) continue;

      const day = parseInt(dayMatch[1]);
      const time = timeMatch ? timeMatch[1] : '';
      const berth = cells[2] || cells[1] || '';
      const name  = cells[3] || cells[2] || '';
      const from  = cells[4] || '';
      const next  = cells[5] || '';

      if (!name || name === '船名' || name === '着岸場所') continue;

      const date = new Date(year, currentMonth - 1, day);
      ships.push({ date: date.toISOString().slice(0, 10), month: currentMonth, day, time, berth, name, from, next });
    }

    // 今日以降30日分
    const today = new Date(); today.setHours(0,0,0,0);
    const limit = new Date(today); limit.setDate(today.getDate() + 30);
    const upcoming = ships.filter(s => {
      const d = new Date(s.date);
      return d >= today && d <= limit;
    }).sort((a, b) => a.date.localeCompare(b.date));

    res.setHeader('Cache-Control', 's-maxage=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ ships: upcoming, source: url });
  } catch(e) {
    res.status(502).json({ error: e.message });
  }
}
