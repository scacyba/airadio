# AIラジオアプリ（Android）Phase 1 設計書

## 0. スコープと前提

### Phase 1 対象機能
1. 年代選択（例: 70s/80s/90s/00s）
2. 懐かしい曲の連続再生
3. 曲間ニュース読み上げ（短尺、RAGなし）

### 技術方針（確定）
- **楽曲再生**: YouTube IFrame Player API を Android WebView 上で利用
- **ニュース音声再生**: ExoPlayer（TTS生成済み音声ファイル再生）
- **LLM**: 第一候補 ChatGPT API、代替 Gemini API
- **ニュース生成**: 固定ソース（RSS/ニュースAPI等）＋テンプレ要約（RAGなし）

---

## 1. Phase 1 詳細アーキテクチャ（文章図）

## 1.1 コンポーネント

### Android
- `RadioActivity/Fragment`（UI）
  - 年代選択、再生/停止、現在状態表示
- `RadioOrchestrator`（再生制御の中心）
  - WebViewプレイヤーとExoPlayerを統合制御
- `YouTubeWebViewPlayer`（WebView + JS Bridge）
  - IFrame APIイベント（READY/STATE_CHANGE/ENDED）を受信
- `NewsAudioPlayer`（ExoPlayerラッパー）
  - ニュース音声URLを再生
- `RadioApiClient`
  - Backend API通信

### Backend
- `Session Service`
  - セッション作成、キュー管理、nextコンテンツ返却
- `Playlist Resolver`
  - 年代に応じたYouTube動画候補リスト生成（事前定義または検索結果キャッシュ）
- `News Script Service`
  - 固定ニュースソース取得→要約テンプレ→LLM短文整形
- `TTS Service`
  - ニュース原稿を音声化（mp3/aac）し、署名付きURL発行
- `Provider Adapter`
  - OpenAI/Gemini切替を吸収

### Data
- `sessions`
  - セッション状態（年代、現在インデックス、再生履歴）
- `tracks_catalog`
  - 年代別候補曲（videoId、title、artist、era）
- `news_cache`
  - 生成済みニュース文キャッシュ（同年代・同日で使い回し）
- `audio_assets`
  - 生成済みTTSファイルメタデータ

## 1.2 データフロー
1. Androidが `POST /radio/session/create` 呼び出し
2. Backendがセッション発行 + 最初の曲を返却
3. AndroidはWebViewで曲再生開始
4. 曲終了イベント受信後、Androidが `GET /radio/session/{id}/next`
5. Backendは「次曲 + 曲間ニュース（script + audioUrl）」を返却
6. AndroidはExoPlayerでニュース再生後、WebViewで次曲再生

---

## 2. API設計（具体）

## 2.1 POST /radio/session/create

### 目的
年代指定でラジオセッションを作成し、初回再生コンテンツを返す。

### Request JSON
```json
{
  "userId": "u_12345",
  "era": "1990s",
  "locale": "ja-JP",
  "newsTone": "nostalgic",
  "client": {
    "appVersion": "1.0.0",
    "platform": "android"
  }
}
```

### Response JSON (201)
```json
{
  "sessionId": "rs_9f2a1",
  "createdAt": "2026-05-23T09:30:00Z",
  "playback": {
    "track": {
      "trackId": "t_001",
      "videoId": "dQw4w9WgXcQ",
      "title": "Sample Song",
      "artist": "Sample Artist",
      "durationSec": 213,
      "era": "1990s"
    },
    "news": null
  },
  "policy": {
    "maxNewsChars": 180,
    "safeMode": true
  }
}
```

### エラー
- `400 INVALID_ERA`
- `422 UNSUPPORTED_LOCALE`
- `429 SESSION_RATE_LIMIT`
- `500 INTERNAL_ERROR`

---

## 2.2 GET /radio/session/{id}/next

### 目的
次の再生ユニット（ニュース＋次曲）を返す。

### Query
- `afterTrackId=t_001`
- `includeNews=true`

### Response JSON (200)
```json
{
  "sessionId": "rs_9f2a1",
  "sequence": 2,
  "playbackUnit": {
    "news": {
      "newsId": "n_782",
      "headline": "1990年代を振り返る経済トピック",
      "script": "ここで当時のニュースをひとつ。1994年は...",
      "charCount": 86,
      "audio": {
        "url": "https://cdn.example.com/tts/n_782.mp3?sig=...",
        "format": "mp3",
        "durationSec": 22
      }
    },
    "track": {
      "trackId": "t_002",
      "videoId": "3JZ4pnNtyxQ",
      "title": "Next Song",
      "artist": "Next Artist",
      "durationSec": 245,
      "era": "1990s"
    }
  }
}
```

### エラー
- `404 SESSION_NOT_FOUND`
- `409 SESSION_STATE_MISMATCH`（afterTrackId不整合）
- `410 SESSION_EXPIRED`
- `429 NEXT_RATE_LIMIT`

---

## 2.3 POST /news/script/generate

### 目的
ニュース短文を単体生成（運用確認・管理画面・A/B検証用途）。

### Request JSON
```json
{
  "era": "1980s",
  "locale": "ja-JP",
  "tone": "warm",
  "maxChars": 180,
  "sourceItems": [
    {
      "title": "1987年の国内景気動向",
      "summary": "...",
      "date": "1987-11-20"
    }
  ],
  "llmProvider": "openai"
}
```

### Response JSON (200)
```json
{
  "newsId": "n_901",
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "script": "80年代を思い出す話題をひとつ。1987年当時は...",
  "charCount": 74,
  "safety": {
    "blocked": false,
    "categories": []
  }
}
```

### エラー
- `400 INVALID_INPUT`
- `413 SCRIPT_TOO_LONG`
- `422 SAFETY_BLOCKED`
- `503 LLM_PROVIDER_UNAVAILABLE`

---

## 2.4 共通エラーフォーマット
```json
{
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "radio session not found",
    "details": {
      "sessionId": "rs_9f2a1"
    },
    "requestId": "req_abc123",
    "timestamp": "2026-05-23T09:35:10Z"
  }
}
```

---

## 3. 再生シーケンス設計（状態遷移）

## 3.1 全体状態
- `IDLE`
- `MUSIC_LOADING`
- `MUSIC_PLAYING`
- `WAITING_NEXT_UNIT`
- `NEWS_LOADING`
- `NEWS_PLAYING`
- `ERROR`

## 3.2 曲終了→ニュース→次曲（標準フロー）
1. `MUSIC_PLAYING`
2. WebView(JS bridge)から `onVideoEnded(trackId)`
3. `WAITING_NEXT_UNIT` に遷移し `GET /next`
4. `NEWS_LOADING`（audioUrlをExoPlayerにprepare）
5. `NEWS_PLAYING`
6. ExoPlayer `STATE_ENDED`
7. `MUSIC_LOADING`（次videoIdをWebViewへpostMessage）
8. WebView `onStateChange(PLAYING)`
9. `MUSIC_PLAYING`

## 3.3 WebView(JS Bridge)イベント
- `onReady`
- `onStateChange(PLAYING|PAUSED|BUFFERING|ENDED)`
- `onError(code)`

Android側は `sealed class PlaybackEvent` として正規化して `RadioOrchestrator` に集約。

## 3.4 競合回避ルール
- ニュース再生中はYouTubeを必ず `pauseVideo()`。
- `GET /next` は `inFlight` フラグで多重呼び出し防止。
- `SESSION_STATE_MISMATCH` 時は `/create` で再同期。

---

## 4. LLMプロンプト雛形

## 4.1 ChatGPT版（OpenAI）

### system
```text
あなたは日本語のラジオ構成作家です。出力は事実ベースで簡潔。誇張・断定を避け、敬体で話してください。
危険行為、差別、個人攻撃、医療/投資の断定助言は禁止。
```

### user template
```text
[目的]
{era}の楽曲の曲間で流す短いニュース原稿を1本作成。

[制約]
- 日本語
- 最大{maxChars}文字
- トーン: {tone}
- 1段落のみ
- 日付・固有名詞はsourceItemsの範囲からのみ使用
- 不確実な情報は「〜とされています」で表現
- 出力は原稿本文のみ（見出し・箇条書き・絵文字禁止）

[sourceItems]
{sourceItems_json}
```

## 4.2 Gemini版

### instruction
```text
あなたは日本語ラジオ番組のニュースライターです。与えられたソース以外を使わず、短く自然な口語で原稿を作成してください。
```

### prompt template
```text
年代: {era}
トーン: {tone}
文字数上限: {maxChars}
安全制約: 有害・差別・断定的助言の禁止

ソース:
{sourceItems_json}

要件:
1) 1段落
2) 読み上げやすい句読点
3) 事実と推測を混同しない
4) 本文のみ出力
```

## 4.3 出力品質ガード
- 文字数チェック（`<= maxChars`）
- NG語彙簡易フィルタ
- 日付/固有名詞がsource外ならリジェクト再生成（最大2回）

---

## 5. Phase 1 実装タスク分解（2〜4週間）

## Week 1: 基盤
1. Androidプロジェクト基盤 + WebView IFrame埋め込み
2. Backend雛形（Session API 3本）
3. tracks_catalog初期データ投入（年代×20曲程度）

**DoD**
- 年代選択→最初の1曲が再生開始する
- `/session/create` と `/next` がモックデータで成功

## Week 2: 曲間ニュース
1. News Script Service（固定ソース整形）
2. OpenAI/Gemini Adapter（まずGemini実装）
3. TTS生成→CDN配置→ExoPlayer再生

**DoD**
- 曲終了後にニュース音声が1本流れ、次曲へ遷移する
- ニュース原稿が文字数制約を守る

## Week 3: 安定化
1. 再生ステートマシン実装（異常系含む）
2. エラーコード統一 + リトライ設計
3. news_cache導入でコスト削減

**DoD**
- 30分連続再生で致命停止なし
- `SESSION_STATE_MISMATCH` から自動復旧

## Week 4 (任意): 運用前仕上げ
1. ログ/メトリクス（再生成功率、ニュース生成遅延、LLMコスト）
2. A/Bパラメータ（tone, maxChars）
3. テスト拡充（API契約テスト、UI自動試験）

**DoD**
- KPIダッシュボードで主要値を可視化
- 回帰テストをCIで自動実行


## 5.1 現在のブランチにおけるDone/Undone整理（2026-05-29時点）

### Done
- [x] Backend雛形: Express常駐プロセスとして `POST /radio/session/create`、`GET /radio/session/:id/next`、`POST /news/script/generate`、`GET /health` を実装済み。
- [x] 共通エラーフォーマット: `code`、`message`、`details`、`requestId`、`timestamp` を返す形式を実装済み。
- [x] セッション管理: in-memory `sessions` によるセッション作成、現在曲管理、`afterTrackId` 不整合時の `SESSION_STATE_MISMATCH` 返却を実装済み。
- [x] tracks_catalog初期データ: `1970s`、`1980s`、`1990s`、`2000s` の年代別データを投入済み（ただし各2曲で、設計上の「年代×20曲程度」には未達）。
- [x] News Script Serviceのモック相当: 固定ソースから短文原稿を生成し、`maxChars` で切り詰める処理を実装済み。
- [x] news_cache: 年代・ロケール・日付単位のインメモリキャッシュを導入済み。
- [x] TTS ServiceのProvider Adapter: `TTS_PROVIDER` 環境変数によりGemini/OpenAIのTTS生成先を切り替える実装を追加済み。
- [x] TTS音声配信: 生成音声を `generated_audio` に保存し、`/audio-assets` または `AUDIO_BASE_URL` 経由のURLを返す実装を追加済み。
- [x] Androidプロジェクト基盤: `frontend/android` にGradle/Compose構成、依存関係、CIビルド定義を追加済み。
- [x] YouTube IFrame用HTML: `youtube_player.html` にIFrame API、`AndroidBridge` イベント通知、`playVideoById`/`pauseVideo` を定義済み。
- [x] Week 3向けMock UI: 再生中、曲間ニュース、リカバリ状態を示すComposeモック画面を追加済み。
- [x] CI: Androidの `assembleDebug`、`testDebugUnitTest`、`lintDebug` を実行するGitHub Actionsを追加済み。

### Undone
- [x] Android E2E接続: 年代選択UI、`HttpRadioApiClient`、`RadioOrchestrator`、WebView/ExoPlayer連携を実装し、年代選択→最初の1曲再生および曲間ニュースTTS再生の経路を接続済み。
- [x] WebView埋め込み実体: Android側のWebView生成、JS Bridge、状態イベント正規化、動画ロード処理を接続済み。
- [x] ExoPlayer実体: Media3 `ExoPlayer` を使う `AndroidNewsAudioPlayer` ラッパーとニュース音声再生フローを実装済み。
- [x] 曲終了→ニュース→次曲の自動遷移: Android側の曲終了イベントから `/next` を取得し、ニュースTTS再生後に次曲再生へ進む制御を接続済み。
- [ ] LLMニュース生成: `POST /news/script/generate` は固定ソースのテンプレ生成であり、OpenAI/GeminiのLLM短文整形呼び出しは未実装。
- [ ] 固定ニュースソース取得: RSS/ニュースAPI等からの取得処理は未実装で、コード内の固定配列に依存している。
- [ ] TTS運用ストレージ: ローカルファイル保存と静的配信はあるが、CDN/S3/GCS等へのアップロード経路と署名付きURL発行は未実装。
- [ ] セッション永続化: `sessions`、`news_cache` はプロセス内Mapのため、再起動や複数インスタンスに対応する永続ストアは未実装。
- [ ] API安定化: `SESSION_EXPIRED`、レート制限、`includeNews` の分岐、`/create` による自動再同期、リトライ設計は未実装。
- [ ] Week 3安定化DoD: 30分連続再生検証、異常系込みの再生ステートマシン、`SESSION_STATE_MISMATCH` からの自動復旧は未達。
- [ ] 運用前仕上げ: ログ/メトリクス、KPIダッシュボード、A/Bパラメータ、API契約テスト、UI自動試験は未実装。
- [x] ドキュメント整合: Android READMEをCompose実装、Backend接続、E2E接続済みフローに合わせて更新済み。

## 優先順位（高→低）
1. 再生フロー成立（曲→ニュース→次曲）
2. API安定化（状態不整合の自己修復）
3. ニュース品質改善（文体・安全・自然さ）
4. コスト最適化（キャッシュ/バッチ）

## 主なリスクと対策
1. **YouTube埋め込み挙動差異**（端末/OS依存）
   - 対策: 主要端末で早期検証、fallback UI、再初期化処理
2. **LLM遅延/失敗**
   - 対策: タイムアウト + テンプレ固定文フォールバック
3. **TTS生成遅延**
   - 対策: `/next` 時点で先読み生成、短文維持（~180字）
4. **APIコスト増**
   - 対策: news_cache（日次・年代単位）、max token厳格化

---

## 6. 実装方針確定（次アクション）

1. Android側 `RadioOrchestrator` と `YouTubeWebViewPlayer` のインタフェースを先に固定
2. Backend API契約（本書JSON）でOpenAPIを作成
3. モック実装でE2E接続（LLM/TTSは後差し）
4. その後にOpenAI実装→必要時Gemini切替

この順序で進めると、Phase 1の最短価値（連続再生体験）を早く検証できます。

---

## 14. バックエンドの動作場所（現状コード）

現状の `backend/src/server.js` は `app.listen(PORT)` で起動する **常駐のNode.jsプロセス向け** 実装。
そのため、いまのまま最も自然に動く場所は以下：

- ローカル開発PC（`node src/server.js`）
- 常駐型サーバ（VM / Docker / Render Web Service など）
- コンテナ常駐のPaaS

> 補足: VercelのServerless Functionsで動かす場合は、`listen` を外して関数ハンドラ化が必要。

### 現状（常駐Node）アーキテクチャ図（テキスト）

```text
[Android App]
  ├─ WebView + YouTube IFrame Player（楽曲）
  ├─ ExoPlayer（ニュース音声）
  └─ API Client (HTTPS)
          |
          v
[Node.js + Express (backend/src/server.js)]
  ├─ POST /radio/session/create
  ├─ GET  /radio/session/:id/next
  ├─ POST /news/script/generate
  ├─ GET  /health
  ├─ sessions: in-memory Map
  └─ tracks_catalog.json 読み込み
          |
          v
[Static Data]
  └─ backend/data/tracks_catalog.json
```

### Vercel無料枠向け（将来）アーキテクチャ図（テキスト）

```text
[Android App]
  ├─ WebView + YouTube IFrame Player（楽曲）
  ├─ ExoPlayer（ニュース音声）
  └─ API Client (HTTPS)
          |
          v
[Vercel Edge/Serverless Functions]
  ├─ /api/radio/session/create
  ├─ /api/radio/session/:id/next
  ├─ /api/news/script/generate
  └─ /api/health
          |
          +--> [KV/Redis/DB (推奨)] セッション永続化
          |
          +--> [tracks_catalog.json or DB] 曲メタデータ
```

### 重要な整理

- **現状実装は「常駐Node前提」**（`app.listen` があるため）。
- **Vercel対応には関数化が必要**（Express appをハンドラとしてエクスポート）。
- **`sessions` の in-memory Map はサーバレス非推奨**（インスタンス再作成で消える）。
