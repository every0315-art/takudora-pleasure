export default async function handler(req, res) {
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

    // 雨かどうかでタクシー需要を判定
    const weatherId = current.weather[0].id;
    let demand = 'やや低め';
    if (weatherId < 600) demand = '高い'; // 雨・雪
    else if (weatherId < 800) demand = 'やや高め'; // 曇り
    else demand = 'やや低め'; // 晴れ

    // 今から3・6・9・12時間後の予報
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

    res.setHeader('Cache-Control', 's-maxage=600'); // 10分キャッシュ
    res.json({ temp, desc, icon, rain, demand, hours });
  } catch (e) {
    res.status(500).json({ error: 'weather fetch failed' });
  }
}
