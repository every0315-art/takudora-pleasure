# タクドラPLEASURE 開発ルール

## デプロイ（最重要）

**必ず `git push` でデプロイすること。`vercel deploy --prod` は絶対に使わない。**

```bash
git add <ファイル>
git commit -m "説明"
git push origin main
```

VercelはGitHub mainブランチと連携済みで、pushすると自動デプロイされる。
`vercel deploy --prod` を使うとGitHubのコードと乖離し、次のgit pushで変更が上書き消滅する事故が起きる。

## プロジェクト概要

- 本番URL: `https://pleasure.delivery-every.com`
- GitHub: `every0315-art/takudora-pleasure`
- タクシー乗務員向け情報アプリ（PWA対応）

## 技術スタック

- フロントエンド: `app.html` 1ファイルに全UI・ロジックを集約（React等不使用）
- バックエンド: `/api/` 以下のVercel Serverless Functions（Node.js ESM）
- 認証・DB: Supabase（`user_data`テーブルでkey-value同期、`community_posts`テーブル）
- ストレージ: Supabase Storage（`post-media`バケット）

## APIファイル一覧

| ファイル | 役割 | リージョン |
|---|---|---|
| `api/haneda-arr.js` | 羽田到着便（公式API + ADS-B） | デフォルト |
| `api/haneda-cam.js` | 羽田国際線第2プール カメラAI解析 | **hnd1（東京）** |
| `api/haneda-cam2.js` | 羽田国内線待機場 カメラAI解析 | **hnd1（東京）** |
| `api/yaesu-cam.js` | 八重洲待機所・乗場 カメラAI解析 | **hnd1（東京）** |
| `api/ships.js` | 客船入港スケジュール（おがさわら丸＋大型客船） | デフォルト |
| `api/weather.js` | 東京天気（OpenWeather API） | デフォルト |
| `api/news.js` | タクシー関連ニュース | デフォルト |
| `api/train-info.js` | 鉄道遅延情報 | デフォルト |
| `api/shinkansen-info.js` | 新幹線情報 | デフォルト |
| `api/shutoko.js` / `shutoko-kisei.js` | 首都高交通情報・規制 | デフォルト |
| `api/parse-report.js` | 現在地投稿解析 | デフォルト |

**カメラAPIは ttc.taxi-inf.jp / p-counter.jp が日本IP限定のため hnd1 必須。**

## 環境変数（Vercel）

- `ANTHROPIC_API_KEY` — Claude Haiku（カメラ解析・客船スケジュール）
- `OPENWEATHER_API_KEY` — 天気API
- Supabase URL/Key — app.html内にハードコード済み

## UI・デザイン

- タブナビゲーションに絵文字・小さなイラストは使わない（テキストまたはシンプルなSVGアイコンのみ）
- コメントは原則書かない。WHYが自明でない場合のみ1行

## 主要な実装メモ

- **PWA/ブラウザ間のデータ共有**: iOSではPWA（ホーム画面）とSafariでlocalStorageが別。Supabase同期ボタンで橋渡し
- **八重洲カメラアラート**: 車両なし検知から5分間アラート継続（見つかっても延長しない）
- **羽田到着便の手荷物中**: 到着時刻から25分以内を「手荷物中」として表示（APIに該当カテゴリなし）
- **遅延カウント除外**: landed/baggage/canceledは60分遅延カウントから除外
