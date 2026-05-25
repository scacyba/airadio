# Airadio Android (Phase 1 Week 2 Scaffold)

## 実装内容
- WebView 上で YouTube IFrame Player API を使う最小構成
- JS Bridge で `onReady` / `onStateChange` / `onError` / `onVideoEnded` を Android に通知
- `RadioOrchestrator` で「曲終了 → /next取得 → ニュース音声再生 → 次曲再生」の順次制御
- `NewsAudioPlayer` / `RadioApiClient` インターフェースを追加し、Week 2 の差し替え可能な構造に整理

## 主要ファイル
- `app/src/main/java/com/airadio/radio/YouTubeWebViewPlayer.kt`
- `app/src/main/java/com/airadio/radio/RadioOrchestrator.kt`
- `app/src/main/java/com/airadio/radio/NewsAudioPlayer.kt`
- `app/src/main/java/com/airadio/radio/RadioApiClient.kt`
- `app/src/main/assets/youtube_player.html`

## 備考
- ExoPlayer 実体は `NewsAudioPlayer` 実装クラスとして Week 2 後半で接続予定。
