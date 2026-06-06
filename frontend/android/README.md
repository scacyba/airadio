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

## AdMobバナー広告
- 画面上部のバックエンドAPI URL表示位置に、AdMobのバナー広告を表示します。
- デフォルトではGoogle公式のテスト用App ID / バナー広告ユニットIDを使います。公開ビルドでは必ず自分のAdMob IDに差し替えてください。
- Google Mobile Ads SDKは `25.3.0` を使用しています。Kotlin metadata 2.3 系の依存関係を含むため、Kotlin Gradle Plugin も `2.3.21` に更新しています。

```bash
ADMOB_APP_ID=ca-app-pub-xxxxxxxxxxxxxxxx~yyyyyyyyyy \
ADMOB_BANNER_AD_UNIT_ID=ca-app-pub-xxxxxxxxxxxxxxxx/zzzzzzzzzz \
./gradlew :app:assembleDebug
```

## ビルド構成
- AGP: `8.13.2`
- Kotlin Gradle Plugin: `2.3.21`
- Gradle Wrapper: `8.13`（`gradle-wrapper.properties`）
- JDK: **17**
- compileSdk: `35`
- minSdk: `24`
- targetSdk: `35`
- namespace / applicationId: `com.skacyba.anataradio`


## Google Play Console アップロード要件
- Google Play の Android 15 要件に合わせ、`compileSdk` / `targetSdk` は API 35 に設定しています。
- 16 KB メモリページサイズ要件に対応し、Kotlin 2.3 系でビルドされた依存関係を扱うため、Android Gradle Plugin は `8.13.2` を使用します。
- AAB内に含まれるSDK由来のネイティブライブラリも新しいものになるよう、Google Mobile Ads SDK を `25.3.0` に更新しています。
- Kotlin 2.x 以降では Compose Compiler が Kotlin リポジトリに統合されているため、`org.jetbrains.kotlin.plugin.compose` を使用します。
- AAB を作り直す場合は、古いAABを再アップロードせず、以下のコマンドで生成した新しい `app-release.aab` を使用してください。

```bash
cd frontend/android
./gradlew :app:bundleRelease
```

## 同期/ビルド手順
```bash
cd frontend/android
./gradlew projects
./gradlew :app:assembleDebug
```

## 実装済みのE2E接続
- 年代選択UI（1960s/1970s/1980s/1990s）から `POST /radio/session/create` を呼び、最初の1曲を取得します。
- 取得した `videoId` を `WebView` 内の YouTube IFrame Playerへ渡して再生します。ローカルHTMLは `loadDataWithBaseURL("https://airadio.local/")` で読み込み、YouTube埋め込みに必要なReferer/originが欠落してError 153にならないようにしています。
- 曲終了または `NEWS / NEXT` ボタンで `GET /radio/session/:id/next` を呼び、年代ニュース原稿とTTS音声URLを取得します。
- ニュースTTS音声を ExoPlayerで再生し、完了後に次曲をYouTubeで再生します。

## 注意点
- Backend側でTTS生成を行うため、`TTS_PROVIDER` に応じて `GEMINI_API_KEY` または `OPENAI_API_KEY` が必要です。
- ローカルHTTP接続のため、デバッグ用途として `usesCleartextTraffic=true` を有効にしています。
