# Airadio Android (frontend/android)

## Android Studioで開くディレクトリ
- **`frontend/android` を開いてください。**
- `frontend` 直下ではなく、Gradleプロジェクト定義（`settings.gradle.kts`）がある `frontend/android` をOpen対象にします。

## プロジェクト種別
- **Jetpack Composeベース**
- YouTube IFrame Playerは `WebView`、ニュースTTS音声は Media3 `ExoPlayer` で再生します。

## Backend接続
- デフォルト接続先: `http://10.0.2.2:8080`（Android EmulatorからローカルPCのBackendへ接続）
- 実機や別ホストを使う場合はビルド時に環境変数で指定します。

```bash
RADIO_API_BASE_URL=http://192.168.0.10:8080 ./gradlew :app:assembleDebug
```

## ビルド構成
- AGP: `8.5.0`
- Kotlin Gradle Plugin: `1.9.24`
- Gradle Wrapper: `8.7`（`gradle-wrapper.properties`）
- JDK: **17**
- compileSdk: `34`
- minSdk: `24`
- targetSdk: `34`
- namespace / applicationId: `com.skacyba.anataradio`

## 同期/ビルド手順
```bash
cd frontend/android
./gradlew projects
./gradlew :app:assembleDebug
```

## 実装済みのE2E接続
- 年代選択UI（1970s/1980s/1990s/2000s）から `POST /radio/session/create` を呼び、最初の1曲を取得します。
- 取得した `videoId` を `WebView` 内の YouTube IFrame Playerへ渡して再生します。ローカルHTMLは `loadDataWithBaseURL("https://airadio.local/")` で読み込み、YouTube埋め込みに必要なReferer/originが欠落してError 153にならないようにしています。
- 曲終了または `NEWS / NEXT` ボタンで `GET /radio/session/:id/next` を呼び、年代ニュース原稿とTTS音声URLを取得します。
- ニュースTTS音声を ExoPlayerで再生し、完了後に次曲をYouTubeで再生します。

## 注意点
- Backend側でTTS生成を行うため、`TTS_PROVIDER` に応じて `GEMINI_API_KEY` または `OPENAI_API_KEY` が必要です。
- ローカルHTTP接続のため、デバッグ用途として `usesCleartextTraffic=true` を有効にしています。
