# Airadio Android (frontend/android)

## Android Studioで開くディレクトリ
- **`frontend/android` を開いてください。**
- `frontend` 直下ではなく、Gradleプロジェクト定義（`settings.gradle.kts`）がある `frontend/android` をOpen対象にします。

## プロジェクト種別
- **XML Viewベース**（Compose未使用）
- Materialは **Material Components (`com.google.android.material:material`)** を採用

## ビルド構成
- AGP: `8.5.0`
- Kotlin Gradle Plugin: `1.9.24`
- Gradle Wrapper: `8.7`（`gradle-wrapper.properties`）
- JDK: **17**
- compileSdk: `34`
- minSdk: `24`
- targetSdk: `34`
- namespace / applicationId: `com.airadio`

## 同期/ビルド手順
```bash
cd frontend/android
./gradlew projects
./gradlew :app:assembleDebug
```

## 追加済みのビルド安定化対応
- `AndroidManifest.xml` の Activity を完全修飾名 `com.airadio.MainActivity` に変更
- layout `tools:context` を完全修飾名に変更
- Materialテーマ参照を解決済み（`Theme.Airadio`）
- 依存関係の不足を補完
  - `androidx.activity:activity-ktx`
  - `androidx.webkit:webkit`
  - `androidx.media3:media3-exoplayer`
  - `androidx.media3:media3-ui`

## 注意点（このリポジトリ時点）
- `RadioApiClient` / `NewsAudioPlayer` はインターフェースのみで、実体実装は未接続です。
  - ただしビルド自体は可能な構成にしています。
- この実行環境では外部Mavenアクセスが403となるため、依存取得を伴う実ビルドは検証できませんでした。
  - 通常の開発環境（Android Studio + インターネット接続）でGradle Sync/Buildしてください。
