import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const tracksCatalog = JSON.parse(fs.readFileSync(new URL('../data/tracks_catalog.json', import.meta.url)));
const sessions = new Map();
const newsCache = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const audioOutputDir = path.resolve(__dirname, '../generated_audio');
fs.mkdirSync(audioOutputDir, { recursive: true });

const SOURCE_NEWS_BY_ERA = {
  '1970s': [{ title: '大阪万博で未来技術に注目', summary: '1970年の万博で新技術が話題に。', date: '1970-03-15' }],
  '1980s': [{ title: 'バブル景気の到来で個人消費が拡大', summary: '1980年代後半に消費マインドが高まる。', date: '1987-11-20' }],
  '1990s': [{ title: 'インターネット普及のはじまり', summary: '家庭向け回線の普及で情報アクセスが拡大。', date: '1995-06-01' }],
  '2000s': [{ title: 'ブロードバンドの一般化', summary: '高速通信の普及でネット動画視聴が日常化。', date: '2004-09-10' }]
};

function error(res, status, code, message, details = {}) {
  return res.status(status).json({
    error: {
      code,
      message,
      details,
      requestId: randomUUID(),
      timestamp: new Date().toISOString()
    }
  });
}

function normalizeEra(era) {
  return typeof era === 'string' ? era.trim() : era;
}

function buildScriptFromSource({ era, tone = 'nostalgic', maxChars = 180, sourceItems = [] }) {
  const src = sourceItems[0] ?? { title: `${era}の出来事`, summary: '当時の雰囲気を伝える話題です。', date: '' };
  const tonePrefix = tone === 'warm' ? 'やさしく振り返ると' : '懐かしく振り返ると';
  let script = `${tonePrefix}、${src.date ? `${src.date}ごろ` : ''}${src.title}。${src.summary}`;
  script = script.replace(/\s+/g, '');
  if (script.length > maxChars) script = script.slice(0, maxChars);
  return script;
}

async function generateNewsScript({ era, locale = 'ja-JP', tone = 'nostalgic', maxChars = 180 }) {
  if (locale !== 'ja-JP') {
    const err = new Error('unsupported locale');
    err.status = 422;
    err.code = 'UNSUPPORTED_LOCALE';
    err.details = { locale };
    throw err;
  }

  const sourceItems = SOURCE_NEWS_BY_ERA[era] ?? [];
  if (!sourceItems.length) {
    const err = new Error('no source for era');
    err.status = 400;
    err.code = 'INVALID_INPUT';
    err.details = { era };
    throw err;
  }

  const script = buildScriptFromSource({ era, tone, maxChars, sourceItems });
  return {
    newsId: `n_${randomUUID().slice(0, 6)}`,
    provider: 'gemini',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    script,
    charCount: script.length,
    sourceItems,
    safety: { blocked: false, categories: [] }
  };
}

function buildPublicBaseUrl(req) {
  const fromEnv = process.env.PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

async function synthesizeNewsAudio({ newsId, script, req }) {
  const audioHash = createHash('sha256').update(script).digest('hex').slice(0, 16);
  const fileName = `${newsId}-${audioHash}.mp3`;
  const outputPath = path.join(audioOutputDir, fileName);

  if (!fs.existsSync(outputPath)) {
    const openAiApiKey = process.env.OPENAI_API_KEY;
    if (!openAiApiKey) {
      const err = new Error('OPENAI_API_KEY is required for TTS generation');
      err.status = 503;
      err.code = 'TTS_PROVIDER_UNAVAILABLE';
      throw err;
    }

    const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
    const voice = process.env.OPENAI_TTS_VOICE || 'alloy';
    const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        voice,
        input: script,
        format: 'mp3'
      })
    });

    if (!ttsResponse.ok) {
      const bodyText = await ttsResponse.text();
      const err = new Error('tts generation failed');
      err.status = 503;
      err.code = 'TTS_PROVIDER_UNAVAILABLE';
      err.details = { status: ttsResponse.status, body: bodyText.slice(0, 300) };
      throw err;
    }

    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    fs.writeFileSync(outputPath, audioBuffer);
  }

  const audioBaseUrl = (process.env.AUDIO_BASE_URL?.trim() || `${buildPublicBaseUrl(req)}/audio-assets`).replace(/\/$/, '');
  return {
    url: `${audioBaseUrl}/${fileName}`,
    format: 'mp3',
    durationSec: 18
  };
}

async function getOrCreateCachedNews({ era, locale, tone, maxChars, req }) {
  const key = `${era}|${locale}|${new Date().toISOString().slice(0, 10)}`;
  if (newsCache.has(key)) {
    return newsCache.get(key);
  }

  const news = await generateNewsScript({ era, locale, tone, maxChars });
  const audio = await synthesizeNewsAudio({ newsId: news.newsId, script: news.script, req });
  const payload = {
    newsId: news.newsId,
    headline: `${era}を振り返るトピック`,
    script: news.script,
    charCount: news.charCount,
    audio,
    provider: news.provider,
    model: news.model
  };
  newsCache.set(key, payload);
  return payload;
}

app.use('/audio-assets', express.static(audioOutputDir, { fallthrough: false }));

app.post('/radio/session/create', (req, res) => {
  const { userId = 'anonymous', era, locale = 'ja-JP' } = req.body || {};
  const normalizedEra = normalizeEra(era);
  if (!normalizedEra || !tracksCatalog[normalizedEra]) {
    return error(res, 400, 'INVALID_ERA', 'invalid era', {
      era: normalizedEra,
      allowedEras: Object.keys(tracksCatalog)
    });
  }
  if (locale !== 'ja-JP') return error(res, 422, 'UNSUPPORTED_LOCALE', 'unsupported locale', { locale });

  const sessionId = `rs_${randomUUID().slice(0, 8)}`;
  const queue = tracksCatalog[normalizedEra];
  const session = { sessionId, userId, era: normalizedEra, locale, index: 0, queue, createdAt: new Date().toISOString() };
  sessions.set(sessionId, session);

  res.status(201).json({
    sessionId,
    createdAt: session.createdAt,
    playback: { track: queue[0], news: null },
    policy: { maxNewsChars: 180, safeMode: true }
  });
});

app.get('/radio/session/:id/next', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return error(res, 404, 'SESSION_NOT_FOUND', 'radio session not found', { sessionId: req.params.id });

  const afterTrackId = req.query.afterTrackId;
  const current = session.queue[session.index];
  if (afterTrackId && afterTrackId !== current.trackId) {
    return error(res, 409, 'SESSION_STATE_MISMATCH', 'afterTrackId mismatch', { expected: current.trackId, actual: afterTrackId });
  }

  session.index = (session.index + 1) % session.queue.length;
  const nextTrack = session.queue[session.index];

  try {
    const news = await getOrCreateCachedNews({ era: session.era, locale: session.locale, tone: 'nostalgic', maxChars: 180, req });
    return res.json({
      sessionId: session.sessionId,
      sequence: session.index + 1,
      playbackUnit: {
        news,
        track: nextTrack
      }
    });
  } catch (e) {
    return error(res, e.status || 500, e.code || 'INTERNAL_ERROR', e.message || 'internal error', e.details || {});
  }
});

app.post('/news/script/generate', async (req, res) => {
  const { era, tone = 'warm', maxChars = 180, locale = 'ja-JP' } = req.body || {};
  const normalizedEra = normalizeEra(era);
  if (!normalizedEra) return error(res, 400, 'INVALID_INPUT', 'era is required');

  try {
    const generated = await generateNewsScript({ era: normalizedEra, locale, tone, maxChars });
    return res.json(generated);
  } catch (e) {
    return error(res, e.status || 500, e.code || 'INTERNAL_ERROR', e.message || 'internal error', e.details || {});
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`airadio backend listening on :${port}`);
});
