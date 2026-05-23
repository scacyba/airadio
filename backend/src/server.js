import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { NewsScriptService } from './services/newsScriptService.js';
import { GeminiAdapter } from './providers/geminiAdapter.js';
import { TtsService } from './services/ttsService.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const tracksCatalog = JSON.parse(fs.readFileSync(new URL('../data/tracks_catalog.json', import.meta.url)));
const sessions = new Map();

const geminiAdapter = new GeminiAdapter();
const newsScriptService = new NewsScriptService({ providerAdapter: geminiAdapter });
const ttsService = new TtsService();

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
  const session = { sessionId, userId, era: normalizedEra, index: 0, queue, createdAt: new Date().toISOString() };
  sessions.set(sessionId, session);

  res.status(201).json({
    sessionId,
    createdAt: session.createdAt,
    playback: { track: queue[0], news: null },
    policy: { maxNewsChars: 180, safeMode: true }
  });
});

app.get('/radio/session/:id/next', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return error(res, 404, 'SESSION_NOT_FOUND', 'radio session not found', { sessionId: req.params.id });

  const afterTrackId = req.query.afterTrackId;
  const current = session.queue[session.index];
  if (afterTrackId && afterTrackId !== current.trackId) {
    return error(res, 409, 'SESSION_STATE_MISMATCH', 'afterTrackId mismatch', { expected: current.trackId, actual: afterTrackId });
  }

  session.index = (session.index + 1) % session.queue.length;
  const nextTrack = session.queue[session.index];

  const newsId = `n_${randomUUID().slice(0, 6)}`;
  const newsHeadline = `${session.era}を振り返るトピック`;
  const scriptResult = newsScriptService.generate({
    era: session.era,
    tone: 'warm',
    maxChars: 180,
    sourceItems: [{ title: newsHeadline }]
  });
  const audio = ttsService.synthesize({
    era: session.era,
    sequence: session.index + 1,
    newsId,
    script: scriptResult.script
  });

  return res.json({
    sessionId: session.sessionId,
    sequence: session.index + 1,
    playbackUnit: {
      news: {
        newsId,
        headline: newsHeadline,
        script: scriptResult.script,
        charCount: scriptResult.charCount,
        provider: scriptResult.provider,
        model: scriptResult.model,
        audio
      },
      track: nextTrack
    }
  });
});

app.post('/news/script/generate', (req, res) => {
  const { era, tone = 'warm', maxChars = 180, sourceItems = [] } = req.body || {};
  const normalizedEra = normalizeEra(era);
  if (!normalizedEra) return error(res, 400, 'INVALID_INPUT', 'era is required');
  if (!tracksCatalog[normalizedEra]) {
    return error(res, 400, 'INVALID_ERA', 'invalid era', { era: normalizedEra, allowedEras: Object.keys(tracksCatalog) });
  }

  const generated = newsScriptService.generate({
    era: normalizedEra,
    tone,
    maxChars,
    sourceItems
  });

  res.json({
    newsId: `n_${randomUUID().slice(0, 6)}`,
    provider: generated.provider,
    model: generated.model,
    script: generated.script,
    charCount: generated.charCount,
    tone: generated.tone,
    safety: generated.safety
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`airadio backend listening on :${port}`);
});
