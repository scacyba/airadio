import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const tracksCatalog = JSON.parse(fs.readFileSync(new URL('../data/tracks_catalog.json', import.meta.url)));
const sessions = new Map();

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

app.post('/radio/session/create', (req, res) => {
  const { userId = 'anonymous', era, locale = 'ja-JP' } = req.body || {};
  const normalizedEra = typeof era === 'string' ? era.trim() : era;
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

  return res.json({
    sessionId: session.sessionId,
    sequence: session.index + 1,
    playbackUnit: {
      news: {
        newsId: `n_${randomUUID().slice(0, 6)}`,
        headline: `${session.era}を振り返るトピック`,
        script: `${session.era}の空気感を思い出すニュースを短くお届けします。`,
        charCount: 32,
        audio: {
          url: `https://cdn.example.com/tts/${session.era}_${session.index}.mp3`,
          format: 'mp3',
          durationSec: 18
        }
      },
      track: nextTrack
    }
  });
});

app.post('/news/script/generate', (req, res) => {
  const { era, tone = 'warm', maxChars = 180, sourceItems = [] } = req.body || {};
  if (!era) return error(res, 400, 'INVALID_INPUT', 'era is required');
  const source = sourceItems[0];
  const basis = source?.title ? `${source.title}について` : `${era}を振り返る話題として`;
  let script = `${basis}、当時を思い出せる短いニュースをお届けします。`;
  if (script.length > maxChars) script = script.slice(0, maxChars);

  res.json({
    newsId: `n_${randomUUID().slice(0, 6)}`,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    script,
    charCount: script.length,
    tone,
    safety: { blocked: false, categories: [] }
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`airadio backend listening on :${port}`);
});
