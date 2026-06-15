export default async function handler(req, res) {
  try {
    const year  = new Date().getFullYear();
    const month = new Date().getMonth() + 1;

    // JOPA情報を掲載している静的HTMLサイトから取得
    const url = `https://kumarisu-cruise.com/tokyo-international-cruise-terminal/`;
    const html = await (await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept-Language': 'ja,en;q=0.9' }
    })).text();

    const ships = [];

    // テーブル行を抽出（<tr>～</tr>）
    for (const rowMatch of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
      if (cells.length < 3) continue;

      // 日付セルを探す: "6/17" "6月17日" "17日" など
      let dateStr = '', shipName = '', arrival = '', departure = '';
      for (const c of cells) {
        if (/^\d{1,2}[\/月]\d{1,2}/.test(c) || /^\d{1,2}日/.test(c)) { dateStr = c; continue; }
        if (/[：:]\d{2}|\d{2}:\d{2}/.test(c) && !arrival) { arrival = c; continue; }
        if (/[：:]\d{2}|\d{2}:\d{2}/.test(c) && !departure) { departure = c; continue; }
        if (c.length > 3 && !shipName) shipName = c;
      }
      if (!dateStr || !shipName) continue;

      // 日付をパース
      let m = month, d = 0;
      const dm = dateStr.match(/(\d{1,2})[\/月](\d{1,2})/);
      if (dm) { m = parseInt(dm[1]); d = parseInt(dm[2]); }
      else { const dm2 = dateStr.match(/(\d{1,2})日/); if (dm2) d = parseInt(dm2[1]); }
      if (!d) continue;

      const date = new Date(year, m - 1, d);
      ships.push({
        date: date.toISOString().slice(0, 10),
        month: m, day: d,
        name: shipName,
        arrival: arrival.replace(/[入港着岸]/g, '').trim(),
        departure: departure.replace(/[出港離岸]/g, '').trim(),
        terminal: '東京国際クルーズターミナル',
      });
    }

    // 今日以降60日
    const today = new Date(); today.setHours(0,0,0,0);
    const limit = new Date(today); limit.setDate(today.getDate() + 60);
    const upcoming = ships
      .filter(s => { const d = new Date(s.date); return d >= today && d <= limit; })
      .sort((a, b) => a.date.localeCompare(b.date))
      // 重複除去
      .filter((s, i, arr) => i === 0 || !(s.date === arr[i-1].date && s.name === arr[i-1].name));

    res.setHeader('Cache-Control', 's-maxage=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ ships: upcoming, count: upcoming.length });
  } catch(e) {
    res.status(502).json({ error: e.message, ships: [] });
  }
}
