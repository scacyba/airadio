# Backend env vars (Render)

## LLM news generation provider switch (env only)
- `LLM_PROVIDER`: `auto` (default), `openai`, `gemini`, or `template`
  - `auto` は `OPENAI_API_KEY` があれば OpenAI、なければ `GEMINI_API_KEY`、どちらもなければローカルテンプレートを使います。
  - `/news/script/generate` の検証時だけ request body の `llmProvider` で上書きできます。

## TTS provider switch (env only)
- `TTS_PROVIDER`: `gemini` (default) or `openai`
  - アプリコード側のIF分岐は不要。環境変数だけでTTSプロバイダを切り替えます。

## Required (when `TTS_PROVIDER=gemini` or `LLM_PROVIDER=gemini`)
- `GEMINI_API_KEY`: Gemini API key

## Required (when `TTS_PROVIDER=openai` or `LLM_PROVIDER=openai`)
- `OPENAI_API_KEY`: OpenAI API key

## Optional
- `PORT`: server port (Render injects automatically)
- `PUBLIC_BASE_URL`: Public service URL (example: `https://airadio.onrender.com`)
  - Used when backend builds its own absolute URL for generated audio.
- `AUDIO_BASE_URL`: CDN base URL for audio delivery (example: `https://cdn.example.com/airadio-audio`)
  - If not set, backend serves generated files from `${PUBLIC_BASE_URL}/audio-assets/...`.

### Gemini news/TTS options
- `GEMINI_NEWS_MODEL`: defaults to `GEMINI_MODEL` or `gemini-2.5-flash`
- `GEMINI_TTS_MODEL`: defaults to `gemini-2.5-flash-preview-tts`
- `GEMINI_TTS_VOICE`: defaults to `Kore`

### OpenAI news/TTS options
- `OPENAI_NEWS_MODEL`: defaults to `gpt-4.1-mini`
- `OPENAI_TTS_MODEL`: defaults to `gpt-4o-mini-tts`
- `OPENAI_TTS_VOICE`: defaults to `alloy`

## Render setup steps (Gemini first)
1. Render Dashboard > Service > **Environment**
2. Add `LLM_PROVIDER=auto` (or explicitly `openai` / `gemini`)
3. Add `TTS_PROVIDER=gemini`
4. Add `GEMINI_API_KEY=<your key>`
5. Add `PUBLIC_BASE_URL=https://<your-render-service>.onrender.com`
6. (If CDN enabled) add `AUDIO_BASE_URL=https://<your-cdn-domain>/<prefix>`
7. Deploy latest commit

## Notes
- `AUDIO_BASE_URL` を設定した場合、APIレスポンスの音声URLはCDNドメインになります。
- ただしCDNへの実ファイルアップロード経路（S3/GCS等）は別途必要です。
