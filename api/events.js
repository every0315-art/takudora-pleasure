// 年間大規模イベント 公式サイト日程確認API
// 非固定イベントのみ公式URLをフェッチしClaude Haikuで2026年日程を抽出
// Vercel CDNで24時間キャッシュ

export const config = { maxDuration: 55 };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// fixed:true = 毎年同じ日付（確認不要）、url:null = 公式サイト確認不可
const BASE_EVENTS = [
  // ── 6月 ──
  { name: '81 MUSIC FESTIVAL', url: 'https://81musicfestival.com/', notionStart: '2026-06-27', notionEnd: '2026-06-27', venue: 'お台場・TOYOTA ARENA TOKYO', demand: 'high', fixed: false },
  { name: '東京みなと祭', url: 'https://www.tokyominatomatsuri.com/', notionStart: '2026-06-27', notionEnd: '2026-06-28', venue: '東京国際クルーズターミナル', demand: 'medium', fixed: false },
  // ── 7月 ──
  { name: 'World DJ Festival Japan', url: 'https://www.worlddjfestival.jp/', notionStart: '2026-07-04', notionEnd: '2026-07-05', venue: '海の森水上競技場', demand: 'high', fixed: false },
  { name: '入谷朝顔市', url: null, notionStart: '2026-07-06', notionEnd: '2026-07-08', venue: '入谷鬼子母神', demand: 'medium', fixed: true },
  { name: 'ほおずき市', url: null, notionStart: '2026-07-09', notionEnd: '2026-07-10', venue: '浅草寺', demand: 'medium', fixed: true },
  // ── 8月 ──
  { name: '原宿表参道元氣祭スーパーよさこい', url: 'https://www.harajuku-omotesando.tokyo/', notionStart: '2026-08-29', notionEnd: '2026-08-30', venue: '原宿・表参道', demand: 'high', fixed: false },
  { name: '高円寺阿波おどり', url: 'https://www.koenji-awaodori.com/', notionStart: '2026-08-29', notionEnd: '2026-08-30', venue: '高円寺', demand: 'high', fixed: false },
  // ── 10月 ──
  { name: 'TOKYO ISLAND', url: 'https://tokyoisland.tokyo/', notionStart: '2026-10-10', notionEnd: '2026-10-12', venue: '海の森公園', demand: 'high', fixed: false },
  { name: '東京よさこい', url: 'https://www.tokyo-yosakoi.com/', notionStart: '2026-10-10', notionEnd: '2026-10-11', venue: '池袋', demand: 'medium', fixed: false },
  { name: '雑司ヶ谷鬼子母神 御会式', url: 'https://www.kishimojin.jp/', notionStart: '2026-10-16', notionEnd: '2026-10-18', venue: '雑司ヶ谷鬼子母神堂', demand: 'medium', fixed: false },
  // ── 11月 ──
  { name: '酉の市（一の酉）', url: null, notionStart: '2026-11-07', notionEnd: '2026-11-07', venue: '鷲神社・花園神社', demand: 'medium', fixed: true },
  { name: '酉の市（二の酉）', url: null, notionStart: '2026-11-19', notionEnd: '2026-11-19', venue: '鷲神社・花園神社', demand: 'medium', fixed: true },
  // ── 12月 ──
  { name: 'カウントダウン・年末イベント', url: null, notionStart: '2026-12-31', notionEnd: '2026-12-31', venue: '都内各所', demand: 'high', fixed: true },
];

// ビッグサイト・国立競技場などは各会場カードで管理するため別管理
const VENUE_EVENTS = [
  { name: 'ハンドメイドインジャパンフェス', url: 'https://hmj-fes.jp/', notionStart: '2026-07-18', notionEnd: '2026-07-19', venue: '東京ビッグサイト', demand: 'medium', fixed: false, venueCard: '東京ビッグサイト' },
  { name: 'コミックマーケット（夏コミ）', url: 'https://www.comiket.co.jp/info-a/C104/C104gaiyo.html', notionStart: '2026-08-15', notionEnd: '2026-08-16', venue: '東京ビッグサイト', demand: 'max', fixed: false, venueCard: '東京ビッグサイト' },
  { name: 'ジャパンモビリティショー', url: 'https://www.japan-mobility-show.com/', notionStart: '2026-10-30', notionEnd: '2026-10-30', venue: '東京ビッグサイト', demand: 'medium', fixed: false, venueCard: '東京ビッグサイト' },
  { name: 'デザインフェスタ（秋）', url: 'https://designfesta.com/', notionStart: '2026-11-14', notionEnd: '2026-11-15', venue: '東京ビッグサイト', demand: 'medium', fixed: false, venueCard: '東京ビッグサイト' },
  { name: 'コミックマーケット（冬コミ）', url: 'https://www.comiket.co.jp/', notionStart: '2026-12-29', notionEnd: '2026-12-31', venue: '東京ビッグサイト', demand: 'max', fixed: false, venueCard: '東京ビッグサイト' },
  { name: '東京レガシーハーフマラソン', url: 'https://www.legacyhalf.tokyo/', notionStart: '2026-10-18', notionEnd: '2026-10-18', venue: '国立競技場', demand: 'low', fixed: false, venueCard: '国立競技場' },
];

const ALL_EVENTS = [...BASE_EVENTS, ...VENUE_EVENTS];

async function fetchPageText(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(10000),
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  // meta + JSON-LD + text content (最大8000文字)
  const metaDesc = (html.match(/<meta[^>]*description[^>]*content="([^"]*)"[^>]*>/i) || [])[1] || '';
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const jsonLd = (html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n').slice(0, 3000);
  const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 5000);
  return `TITLE: ${title}\nMETA: ${metaDesc}\nJSON-LD: ${jsonLd}\nBODY: ${bodyText}`;
}

async function extractDateWithClaude(eventName, pageText, apiKey) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `「${eventName}」の2026年開催日程をこのページ内容から抽出してください。JSONのみ返答: {"found":true,"start":"YYYY-MM-DD","end":"YYYY-MM-DD"} または {"found":false}\n\n${pageText}`,
      }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}`);
  const data = await r.json();
  const text = (data.content?.[0]?.text || '').trim();
  const m = text.match(/\{[^}]+\}/);
  if (!m) return null;
  return JSON.parse(m[0]);
}

async function verifyEvent(ev, apiKey) {
  if (ev.fixed || !ev.url) return { ...ev, verified: ev.fixed, verifiedAt: null };
  try {
    const pageText = await fetchPageText(ev.url);
    const result = await extractDateWithClaude(ev.name, pageText, apiKey);
    if (result?.found && result.start) {
      return {
        ...ev,
        start: result.start,
        end: result.end || result.start,
        verified: true,
        verifiedAt: new Date().toISOString(),
      };
    }
    return { ...ev, verified: false, verifiedAt: new Date().toISOString() };
  } catch {
    return { ...ev, verified: false, verifiedAt: null };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Vercel CDN 24時間キャッシュ
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // 過去イベントはスキップ（今日以降のみ確認）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = ALL_EVENTS.filter(ev => new Date(ev.notionEnd) >= today);

  const results = await Promise.allSettled(upcoming.map(ev => verifyEvent(ev, apiKey)));

  const events = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { ...upcoming[i], verified: false }
  );

  return res.json({ events, updatedAt: new Date().toISOString() });
}
