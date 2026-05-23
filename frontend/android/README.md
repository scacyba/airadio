# Airadio Android (Phase 1 Week 1 Scaffold)

## 実装内容
- WebView 上で YouTube IFrame Player API を使う最小構成
- JS Bridge で `onReady` / `onStateChange` / `onError` / `onVideoEnded` を Android に通知
- `RadioOrchestrator` で曲再生開始と終了イベントを受け取る土台

## 主要ファイル
- `app/src/main/java/com/airadio/radio/YouTubeWebViewPlayer.kt`
- `app/src/main/java/com/airadio/radio/RadioOrchestrator.kt`
- `app/src/main/assets/youtube_player.html`

## 備考
- 本コミットは Week 1 の土台実装です（UI 完成前）。
- ニュース音声の ExoPlayer 本実装は Week 2 対象。
