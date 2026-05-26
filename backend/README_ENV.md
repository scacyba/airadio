# Backend env vars (Render)

## Required for TTS generation
- `OPENAI_API_KEY`: OpenAI API key

## Optional
- `PORT`: server port (Render injects automatically)
- `PUBLIC_BASE_URL`: Public service URL (example: `https://airadio.onrender.com`)
  - Used when backend builds its own absolute URL for generated audio.
- `AUDIO_BASE_URL`: CDN base URL for audio delivery (example: `https://cdn.example.com/airadio-audio`)
  - If not set, backend serves generated files from `${PUBLIC_BASE_URL}/audio-assets/...`.
- `OPENAI_TTS_MODEL`: defaults to `gpt-4o-mini-tts`
- `OPENAI_TTS_VOICE`: defaults to `alloy`

## Render setup steps
1. Render Dashboard > Service > **Environment**
2. Add `OPENAI_API_KEY`
3. Add `PUBLIC_BASE_URL=https://<your-render-service>.onrender.com`
4. (If CDN enabled) add `AUDIO_BASE_URL=https://<your-cdn-domain>/<prefix>`
5. Deploy latest commit

