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
  - Gemini TTS の PCM (`audio/L16`) 応答は Backend 側で WAV に包んで配信します。

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

## Neon PostgreSQL / Drizzle news script storage

### Required database env var
- `DATABASE_URL`: Neon PostgreSQL connection string.
  - Example: `postgresql://<user>:<password>@<neon-host>/<database>?sslmode=require`
  - The backend reads this value at runtime for `GET /news-scripts` and `GET /news-scripts/random`.

### Local setup
1. Install backend dependencies:
   ```bash
   cd backend
   npm install
   ```
2. Set the Neon connection string:
   ```bash
   export DATABASE_URL="postgresql://<user>:<password>@<neon-host>/<database>?sslmode=require"
   ```
3. Apply Drizzle migrations:
   ```bash
   npm run db:migrate
   ```
4. Seed initial news scripts from the default JSON file (`data/news_scripts.seed.json`):
   ```bash
   npm run db:seed
   ```
   To seed another JSON file, pass the path after `--`:
   ```bash
   npm run db:seed -- ./data/custom-news-scripts.json
   ```

### News script APIs
- `GET /news-scripts`: returns published news scripts.
- `GET /news-scripts/random`: returns one random published news script.
- Both endpoints accept optional query parameters:
  - `year`: positive integer, e.g. `1995`
  - `month`: `1` to `12`, e.g. `6`
  - `category`: exact category string, e.g. `technology`

### Render environment variable setup
1. Render Dashboard > Service > **Environment**
2. Add `DATABASE_URL=<your Neon PostgreSQL connection string>`
3. Keep the existing LLM/TTS env vars you need (`LLM_PROVIDER`, `TTS_PROVIDER`, API keys, etc.)
4. Deploy latest commit
5. Run the migration command once against the same Neon database:
   ```bash
   cd backend && npm run db:migrate
   ```
6. Run the seed command when initial JSON data should be loaded:
   ```bash
   cd backend && npm run db:seed
   ```

### Drizzle files
- Schema: `src/db/schema.js`
- Drizzle config: `drizzle.config.js`
- SQL migration: `drizzle/0000_create_news_scripts.sql`
- Seed script: `scripts/seed-news-scripts.js`
- Default seed JSON: `data/news_scripts.seed.json`

## Track catalog storage and seeding

YouTube playback tracks are stored in PostgreSQL in the `tracks` table. The legacy `backend/data/tracks_catalog.json` catalog is no longer used.

1. Apply migrations after setting `DATABASE_URL`:
   ```bash
   npm run db:migrate
   ```
2. Seed the curated 1960s-1990s track list:
   ```bash
   npm run db:seed:tracks
   ```
3. To resolve missing `videoId` values from YouTube during seeding, set `YOUTUBE_API_KEY` and run:
   ```bash
   npm run db:seed:tracks:youtube
   ```

The app only returns tracks with a playable `videoId`. If seeded rows do not already contain `videoId`, the backend can resolve one at request time when `YOUTUBE_API_KEY` is available.
