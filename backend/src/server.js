import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const tracksCatalog = JSON.parse(fs.readFileSync(new URL('../data/tracks_catalog.json', import.meta.url)));
const sessions = new Map();
const newsCache = new Map();

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
    provider: 'openai',
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    script,
    charCount: script.length,
    sourceItems,
    safety: { blocked: false, categories: [] }
  };
}

function synthesizeNewsAudio(newsId) {
  return {
    url: `/audio/${newsId}.mp3`,
    format: 'mp3',
    durationSec: 18
  };
}

function getOrCreateCachedNews({ era, locale, tone, maxChars }) {
  const key = `${era}|${locale}|${new Date().toISOString().slice(0, 10)}`;
  if (newsCache.has(key)) {
    return newsCache.get(key);
  }

  return generateNewsScript({ era, locale, tone, maxChars }).then((news) => {
    const audio = synthesizeNewsAudio(news.newsId);
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
  });
}

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
    const news = await getOrCreateCachedNews({ era: session.era, locale: session.locale, tone: 'nostalgic', maxChars: 180 });
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

app.get('/audio/:newsId.mp3', (req, res) => {
  res.setHeader('Content-Type', 'audio/mpeg');
  // Week2 scaffold: 擬似TTS音声。実装時はCDN/S3署名URLを返す。
  return res.status(204).end();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`airadio backend listening on :${port}`);
});
