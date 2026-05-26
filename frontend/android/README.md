# Airadio Android (Phase 1 Week 3 Scaffold)

## 実装内容
- WebView 上で YouTube IFrame Player API を使う最小構成
- JS Bridge で `onReady` / `onStateChange` / `onError` / `onVideoEnded` を Android に通知
- `RadioOrchestrator` に Week 3 の再生ステートを導入（`IDLE` / `MUSIC_LOADING` / `MUSIC_PLAYING` / `WAITING_NEXT_UNIT` / `NEWS_LOADING` / `NEWS_PLAYING` / `ERROR`）
- 曲終了時に `/next` を取得してニュース音声を再生し、完了後に次曲へ遷移
- `SESSION_STATE_MISMATCH` の場合は `afterTrackId` なしで `/next` を再試行して自動復旧
- `NewsAudioPlayer` / `RadioApiClient` インターフェースで ExoPlayer/API 実装を差し替え可能

## 主要ファイル
- `app/src/main/java/com/airadio/radio/YouTubeWebViewPlayer.kt`
- `app/src/main/java/com/airadio/radio/RadioOrchestrator.kt`
- `app/src/main/java/com/airadio/radio/NewsAudioPlayer.kt`
- `app/src/main/java/com/airadio/radio/RadioApiClient.kt`
- `app/src/main/assets/youtube_player.html`

## 画面イメージ
- `../../docs/week3_screen_mock.svg` (Week3 の遷移イメージ)

## 備考
- ExoPlayer 実体は `NewsAudioPlayer` 実装クラスとして接続。
