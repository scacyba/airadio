import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseNewsScriptFilters } from './newsScriptFilters.js';
import { getRandomNewsScriptForEra } from './newsScripts.js';
import { ALLOWED_TRACK_ERAS, isAllowedTrackEra, selectRandomPlayableTrack, toPlaybackTrack } from './tracks.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessions = new Map();
const newsCache = new Map();
const MAX_CLIENT_REQUEST_CACHE_SIZE = 20;

function rememberClientRequest(session, clientRequestId, responsePayload) {
  if (!clientRequestId) return;
  session.clientRequests.set(clientRequestId, responsePayload);
  while (session.clientRequests.size > MAX_CLIENT_REQUEST_CACHE_SIZE) {
    const oldestKey = session.clientRequests.keys().next().value;
    session.clientRequests.delete(oldestKey);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const audioOutputDir = path.resolve(__dirname, '../generated_audio');
fs.mkdirSync(audioOutputDir, { recursive: true });

const SOURCE_NEWS_BY_ERA = {
  '1960s': [{ title: '東京オリンピックで日本中が沸く', summary: '1964年の東京大会をきっかけにテレビのある暮らしが広がりました。', date: '1964-10-10' }],
  '1970s': [{ title: '大阪万博で未来技術に注目', summary: '1970年の万博で新技術が話題に。', date: '1970-03-15' }],
  '1980s': [{ title: 'バブル景気の到来で個人消費が拡大', summary: '1980年代後半に消費マインドが高まる。', date: '1987-11-20' }],
  '1990s': [{ title: 'インターネット普及のはじまり', summary: '家庭向け回線の普及で情報アクセスが拡大。', date: '1995-06-01' }]
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

function normalizeMaxChars(maxChars) {
  const parsed = Number(maxChars);
  if (!Number.isFinite(parsed)) return 180;
  return Math.min(300, Math.max(40, Math.trunc(parsed)));
}

function normalizeSourceItems(sourceItems) {
  if (!Array.isArray(sourceItems)) return [];
  return sourceItems
    .map((item) => ({
      title: String(item?.title || '').trim(),
      summary: String(item?.summary || '').trim(),
      detail: String(item?.detail || '').trim(),
      date: String(item?.date || '').trim()
    }))
    .filter((item) => item.title && (item.summary || item.detail))
    .slice(0, 3);
}

function stripSurroundingQuotes(text) {
  return text.replace(/^[「『\"'\s]+|[」』\"'\s]+$/g, '');
}

function sanitizeGeneratedScript(text, maxChars) {
  const script = stripSurroundingQuotes(String(text || ''))
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return script.length > maxChars ? script.slice(0, maxChars) : script;
}

function buildScriptFromSource({ era, tone = 'nostalgic', maxChars = 180, sourceItems = [] }) {
  const src = sourceItems[0] ?? { title: `${era}の出来事`, summary: '当時の雰囲気を伝える話題です。', date: '' };
  const tonePrefix = tone === 'warm' ? 'やさしく振り返ると' : '懐かしく振り返ると';
  const sourceText = src.summary || src.detail || '当時の雰囲気を伝える話題です。';
  let script = `${tonePrefix}、${src.date ? `${src.date}ごろ` : ''}${src.title}。${sourceText}`;
  script = script.replace(/\s+/g, '');
  if (script.length > maxChars) script = script.slice(0, maxChars);
  return script;
}

function resolveLlmProvider(requestedProvider) {
  const rawProvider = String(requestedProvider || process.env.LLM_PROVIDER || 'auto').trim().toLowerCase();
  if (rawProvider === 'auto') {
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.GEMINI_API_KEY) return 'gemini';
    return 'template';
  }

  const allowedProviders = ['openai', 'gemini', 'template'];
  if (!allowedProviders.includes(rawProvider)) {
    const err = new Error('unsupported llm provider');
    err.status = 400;
    err.code = 'INVALID_LLM_PROVIDER';
    err.details = { provider: rawProvider, allowedProviders: ['auto', ...allowedProviders] };
    throw err;
  }
  return rawProvider;
}

function calculateNewsOutputTokenBudget(maxChars) {
  return Math.max(256, Math.ceil(maxChars * 2.5));
}

function calculateGeminiNewsThinkingBudget(rawBudget = process.env.GEMINI_NEWS_THINKING_BUDGET) {
  if (rawBudget === undefined || rawBudget === '') return 0;
  const parsed = Number(rawBudget);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-1, Math.trunc(parsed));
}

function supportsGeminiThinkingConfig(model) {
  return String(model || '').includes('2.5') || process.env.GEMINI_NEWS_THINKING_BUDGET !== undefined;
}

function isLlmNewsResultTruncated(result) {
  if (result?.finishReason === 'MAX_TOKENS') return true;
  if (result?.status === 'incomplete') return true;
  return result?.incompleteReason === 'max_output_tokens';
}

function buildNewsPrompt({ era, locale, tone, maxChars, sourceItems }) {
  const toneInstruction = tone === 'warm'
    ? 'やさしく親しみやすい口調'
    : '懐かしさを感じるラジオDJ風の口調';
  const sources = sourceItems.map((item, index) => {
    const detail = item.detail ? ` detail=${item.detail}` : '';
    return `${index + 1}. date=${item.date || 'unknown'} title=${item.title} summary=${item.summary || 'none'}${detail}`;
  }).join('\n');

  return [
    'あなたは日本語ラジオ番組の曲間ニュース原稿ライターです。',
    `対象年代: ${era}`,
    `ロケール: ${locale}`,
    `口調: ${toneInstruction}`,
    `制約: ${maxChars}文字以内。ニュース原稿本文だけを出力。箇条書き、見出し、引用符、出典表記は不要。`,
    '固定ニュースソースの事実だけを使い、断定しすぎず短く自然な一文から二文にしてください。',
    'ソース:',
    sources
  ].join('\n');
}

function extractOpenAiText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((part) => part?.type === 'output_text' && typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function extractGeminiText(payload) {
  return (payload?.candidates?.[0]?.content?.parts || [])
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

async function callOpenAiForNews(prompt, maxChars) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY is required for OpenAI news generation');
    err.status = 503;
    err.code = 'LLM_PROVIDER_UNAVAILABLE';
    throw err;
  }

  const model = process.env.OPENAI_NEWS_MODEL || 'gpt-4.1-mini';
  const outputTokenBudget = calculateNewsOutputTokenBudget(maxChars);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: outputTokenBudget,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const err = new Error('openai news generation failed');
    err.status = 503;
    err.code = 'LLM_PROVIDER_UNAVAILABLE';
    err.details = { status: response.status, body: bodyText.slice(0, 300) };
    throw err;
  }

  const payload = await response.json();
  return {
    provider: 'openai',
    model,
    text: extractOpenAiText(payload),
    status: payload?.status,
    incompleteReason: payload?.incomplete_details?.reason,
    raw: payload
  };
}

async function callGeminiForNews(prompt, maxChars) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is required for Gemini news generation');
    err.status = 503;
    err.code = 'LLM_PROVIDER_UNAVAILABLE';
    throw err;
  }

  const model = process.env.GEMINI_NEWS_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const outputTokenBudget = calculateNewsOutputTokenBudget(maxChars);
  const generationConfig = {
    temperature: 0.7,
    maxOutputTokens: outputTokenBudget
  };
  if (supportsGeminiThinkingConfig(model)) {
    generationConfig.thinkingConfig = {
      thinkingBudget: calculateGeminiNewsThinkingBudget()
    };
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig
    })
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const err = new Error('gemini news generation failed');
    err.status = 503;
    err.code = 'LLM_PROVIDER_UNAVAILABLE';
    err.details = { status: response.status, body: bodyText.slice(0, 300) };
    throw err;
  }

  const payload = await response.json();
  if (payload?.promptFeedback?.blockReason) {
    const err = new Error('news generation blocked by safety filter');
    err.status = 422;
    err.code = 'SAFETY_BLOCKED';
    err.details = { blockReason: payload.promptFeedback.blockReason };
    throw err;
  }

  return {
    provider: 'gemini',
    model,
    text: extractGeminiText(payload),
    finishReason: payload?.candidates?.[0]?.finishReason,
    raw: payload
  };
}

async function requestLlmNewsScript({ provider, prompt, maxChars }) {
  if (provider === 'openai') return callOpenAiForNews(prompt, maxChars);
  if (provider === 'gemini') return callGeminiForNews(prompt, maxChars);
  return { provider: 'template', model: 'local-template', text: '', raw: null };
}

async function generateNewsScript({ era, locale = 'ja-JP', tone = 'nostalgic', maxChars = 180, sourceItems, llmProvider }) {
  if (locale !== 'ja-JP') {
    const err = new Error('unsupported locale');
    err.status = 422;
    err.code = 'UNSUPPORTED_LOCALE';
    err.details = { locale };
    throw err;
  }

  const resolvedMaxChars = normalizeMaxChars(maxChars);
  const normalizedSources = normalizeSourceItems(sourceItems);
  const resolvedSourceItems = normalizedSources.length ? normalizedSources : (SOURCE_NEWS_BY_ERA[era] ?? []);
  if (!resolvedSourceItems.length) {
    const err = new Error('no source for era');
    err.status = 400;
    err.code = 'INVALID_INPUT';
    err.details = { era };
    throw err;
  }

  const provider = resolveLlmProvider(llmProvider);
  const prompt = buildNewsPrompt({ era, locale, tone, maxChars: resolvedMaxChars, sourceItems: resolvedSourceItems });
  const llmResult = await requestLlmNewsScript({ provider, prompt, maxChars: resolvedMaxChars });
  const templateScript = buildScriptFromSource({ era, tone, maxChars: resolvedMaxChars, sourceItems: resolvedSourceItems });
  const sanitizedLlmScript = isLlmNewsResultTruncated(llmResult)
    ? ''
    : sanitizeGeneratedScript(llmResult.text, resolvedMaxChars);
  const script = sanitizedLlmScript || templateScript;

  if (script.length > resolvedMaxChars) {
    const err = new Error('generated script is too long');
    err.status = 413;
    err.code = 'SCRIPT_TOO_LONG';
    err.details = { charCount: script.length, maxChars: resolvedMaxChars };
    throw err;
  }

  return {
    newsId: `n_${randomUUID().slice(0, 6)}`,
    provider: llmResult.provider,
    model: llmResult.model,
    script,
    charCount: script.length,
    sourceItems: resolvedSourceItems,
    safety: { blocked: false, categories: [] },
    generatedByFallback: !sanitizedLlmScript
  };
}

function buildPublicBaseUrl(req) {
  const fromEnv = process.env.PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function parseAudioMimeType(mimeType = '') {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  const rateMatch = normalizedMimeType.match(/rate=(\d+)/);
  const rate = rateMatch ? Number(rateMatch[1]) : undefined;

  if (normalizedMimeType.includes('audio/mpeg') || normalizedMimeType.includes('audio/mp3')) {
    return { format: 'mp3', mimeType: normalizedMimeType || 'audio/mpeg', sampleRateHz: rate };
  }

  if (normalizedMimeType.includes('audio/wav') || normalizedMimeType.includes('audio/x-wav')) {
    return { format: 'wav', mimeType: normalizedMimeType || 'audio/wav', sampleRateHz: rate };
  }

  if (normalizedMimeType.includes('audio/l16') || normalizedMimeType.includes('pcm')) {
    return { format: 'pcm', mimeType: normalizedMimeType || 'audio/L16', sampleRateHz: rate || 24000 };
  }

  return { format: 'unknown', mimeType: normalizedMimeType, sampleRateHz: rate };
}

function writeAscii(buffer, offset, value) {
  buffer.write(value, offset, value.length, 'ascii');
}

function wrapPcm16leAsWav(pcmBuffer, { sampleRateHz = 24000, channels = 1 } = {}) {
  const bitsPerSample = 16;
  const byteRate = sampleRateHz * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);

  writeAscii(header, 0, 'RIFF');
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  writeAscii(header, 8, 'WAVE');
  writeAscii(header, 12, 'fmt ');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  writeAscii(header, 36, 'data');
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

function normalizeTtsAudioBuffer(audioBuffer, mimeType) {
  const parsedMimeType = parseAudioMimeType(mimeType);
  if (parsedMimeType.format === 'pcm') {
    return {
      buffer: wrapPcm16leAsWav(audioBuffer, { sampleRateHz: parsedMimeType.sampleRateHz }),
      format: 'wav',
      mimeType: 'audio/wav'
    };
  }

  if (parsedMimeType.format === 'wav') {
    return { buffer: audioBuffer, format: 'wav', mimeType: parsedMimeType.mimeType || 'audio/wav' };
  }

  return { buffer: audioBuffer, format: 'mp3', mimeType: parsedMimeType.mimeType || 'audio/mpeg' };
}

async function requestTtsAudio(script) {
  const provider = (process.env.TTS_PROVIDER || 'gemini').trim().toLowerCase();

  const providers = {
    gemini: async () => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        const err = new Error('GEMINI_API_KEY is required for Gemini TTS generation');
        err.status = 503;
        err.code = 'TTS_PROVIDER_UNAVAILABLE';
        throw err;
      }

      const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
      const voice = process.env.GEMINI_TTS_VOICE || 'Kore';
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: script }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice
                }
              }
            }
          }
        })
      });

      if (!response.ok) {
        const bodyText = await response.text();
        const err = new Error('gemini tts generation failed');
        err.status = 503;
        err.code = 'TTS_PROVIDER_UNAVAILABLE';
        err.details = { status: response.status, body: bodyText.slice(0, 300) };
        throw err;
      }

      const payload = await response.json();
      const audioPart = payload?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
      const audioBase64 = audioPart?.inlineData?.data;
      if (!audioBase64) {
        const err = new Error('gemini tts audio payload not found');
        err.status = 503;
        err.code = 'TTS_PROVIDER_UNAVAILABLE';
        err.details = { provider: 'gemini' };
        throw err;
      }

      return normalizeTtsAudioBuffer(
        Buffer.from(audioBase64, 'base64'),
        audioPart.inlineData?.mimeType || 'audio/L16;codec=pcm;rate=24000'
      );
    },
    openai: async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        const err = new Error('OPENAI_API_KEY is required for OpenAI TTS generation');
        err.status = 503;
        err.code = 'TTS_PROVIDER_UNAVAILABLE';
        throw err;
      }

      const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
      const voice = process.env.OPENAI_TTS_VOICE || 'alloy';
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, voice, input: script, format: 'mp3' })
      });

      if (!response.ok) {
        const bodyText = await response.text();
        const err = new Error('openai tts generation failed');
        err.status = 503;
        err.code = 'TTS_PROVIDER_UNAVAILABLE';
        err.details = { status: response.status, body: bodyText.slice(0, 300) };
        throw err;
      }

      return { buffer: Buffer.from(await response.arrayBuffer()), format: 'mp3', mimeType: 'audio/mpeg' };
    }
  };

  const ttsHandler = providers[provider];
  if (!ttsHandler) {
    const err = new Error('unsupported tts provider');
    err.status = 400;
    err.code = 'INVALID_TTS_PROVIDER';
    err.details = { provider, allowedProviders: Object.keys(providers) };
    throw err;
  }

  return ttsHandler();
}

async function synthesizeNewsAudio({ newsId, script, req }) {
  const provider = (process.env.TTS_PROVIDER || 'gemini').trim().toLowerCase();
  const audioHash = createHash('sha256').update(`${provider}:${script}`).digest('hex').slice(0, 16);
  const existingAudio = ['mp3', 'wav']
    .map((format) => ({ format, fileName: `${newsId}-${audioHash}.${format}` }))
    .find(({ fileName }) => fs.existsSync(path.join(audioOutputDir, fileName)));

  let format;
  let fileName;
  if (existingAudio) {
    ({ format, fileName } = existingAudio);
  } else {
    const audio = await requestTtsAudio(script);
    format = audio.format;
    fileName = `${newsId}-${audioHash}.${format}`;
    fs.writeFileSync(path.join(audioOutputDir, fileName), audio.buffer);
  }

  const audioBaseUrl = (process.env.AUDIO_BASE_URL?.trim() || `${buildPublicBaseUrl(req)}/audio-assets`).replace(/\/$/, '');
  return {
    url: `${audioBaseUrl}/${fileName}`,
    format,
    durationSec: 18
  };
}

function buildNewsCacheKey({ era, locale, tone, maxChars, providerKey = process.env.LLM_PROVIDER || 'auto', newsScriptId, todayKey = new Date().toISOString().slice(0, 10) }) {
  const sourceKey = newsScriptId || 'fallback';
  return `${era}|${locale}|${tone}|${maxChars}|${providerKey}|${sourceKey}|${todayKey}`;
}

function newsScriptToSourceItems(newsScript) {
  if (!newsScript) return undefined;
  return [{
    title: newsScript.title,
    summary: newsScript.summary,
    detail: newsScript.scriptText,
    date: typeof newsScript.date === 'string' ? newsScript.date.slice(0, 10) : ''
  }];
}

async function getOrCreateCachedNews({ era, locale, tone, maxChars, req, sourceItems, newsScriptId, headline }) {
  const providerKey = process.env.LLM_PROVIDER || 'auto';
  const key = buildNewsCacheKey({ era, locale, tone, maxChars, providerKey, newsScriptId });
  if (newsCache.has(key)) {
    return newsCache.get(key);
  }

  const news = await generateNewsScript({ era, locale, tone, maxChars, sourceItems });
  const audio = await synthesizeNewsAudio({ newsId: news.newsId, script: news.script, req });
  const payload = {
    newsId: news.newsId,
    newsScriptId: newsScriptId || null,
    headline: headline || `${era}を振り返るトピック`,
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

async function getTrackStore() {
  const [{ getDb }, { tracks, newsScripts }] = await Promise.all([
    import('./db/client.js'),
    import('./db/schema.js')
  ]);
  return { db: getDb(), tracks, newsScripts };
}

function validateTrackEra(res, era) {
  const normalizedEra = normalizeEra(era);
  if (!normalizedEra || !isAllowedTrackEra(normalizedEra)) {
    error(res, 400, 'INVALID_ERA', 'invalid era', {
      era: normalizedEra,
      allowedEras: ALLOWED_TRACK_ERAS
    });
    return null;
  }
  return normalizedEra;
}

app.post('/radio/session/create', async (req, res) => {
  const { userId = 'anonymous', era, locale = 'ja-JP' } = req.body || {};
  const normalizedEra = validateTrackEra(res, era);
  if (!normalizedEra) return;
  if (locale !== 'ja-JP') return error(res, 422, 'UNSUPPORTED_LOCALE', 'unsupported locale', { locale });

  try {
    const { db, tracks } = await getTrackStore();
    const selectedTrack = await selectRandomPlayableTrack(db, tracks, { era: normalizedEra });
    if (!selectedTrack?.videoId) {
      return error(res, 404, 'TRACK_NOT_FOUND', 'playable track not found', { era: normalizedEra });
    }

    const sessionId = `rs_${randomUUID().slice(0, 8)}`;
    const session = {
      sessionId,
      userId,
      era: normalizedEra,
      locale,
      currentTrackId: selectedTrack.trackId,
      playedTrackIds: [selectedTrack.trackId],
      skippedTrackIds: [],
      clientRequests: new Map(),
      sequence: 1,
      createdAt: new Date().toISOString()
    };
    sessions.set(sessionId, session);

    return res.status(201).json({
      sessionId,
      createdAt: session.createdAt,
      playback: { track: toPlaybackTrack(selectedTrack), news: null },
      policy: { maxNewsChars: 180, safeMode: true }
    });
  } catch (e) {
    return error(res, e.status || 500, e.code || 'INTERNAL_ERROR', e.message || 'internal error', e.details || {});
  }
});

app.get('/radio/session/:id/next', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return error(res, 404, 'SESSION_NOT_FOUND', 'radio session not found', { sessionId: req.params.id });

  const clientRequestId = typeof req.query.clientRequestId === 'string' ? req.query.clientRequestId.trim() : undefined;
  if (clientRequestId && session.clientRequests.has(clientRequestId)) {
    return res.json(session.clientRequests.get(clientRequestId));
  }

  const afterTrackId = typeof req.query.afterTrackId === 'string' ? req.query.afterTrackId : undefined;
  if (afterTrackId && afterTrackId !== session.currentTrackId) {
    return error(res, 409, 'SESSION_STATE_MISMATCH', 'afterTrackId mismatch', { expected: session.currentTrackId, actual: afterTrackId });
  }

  const skipTrackId = typeof req.query.skipTrackId === 'string' ? req.query.skipTrackId : undefined;
  if (skipTrackId && !session.skippedTrackIds.includes(skipTrackId)) {
    session.skippedTrackIds.push(skipTrackId);
  }

  try {
    const { db, tracks, newsScripts } = await getTrackStore();
    const excludeTrackIds = [session.currentTrackId, skipTrackId, ...session.skippedTrackIds];
    let nextTrack = await selectRandomPlayableTrack(db, tracks, {
      era: session.era,
      excludeTrackIds,
      playedTrackIds: session.playedTrackIds
    });

    if (!nextTrack?.videoId) {
      session.playedTrackIds = session.currentTrackId ? [session.currentTrackId] : [];
      nextTrack = await selectRandomPlayableTrack(db, tracks, {
        era: session.era,
        excludeTrackIds,
        playedTrackIds: []
      });
    }

    if (!nextTrack?.videoId) {
      return error(res, 404, 'TRACK_NOT_FOUND', 'playable track not found', { era: session.era });
    }

    session.currentTrackId = nextTrack.trackId;
    session.playedTrackIds = [...new Set([...session.playedTrackIds, nextTrack.trackId])];
    session.sequence += 1;

    const newsScript = await getRandomNewsScriptForEra(db, newsScripts, session.era);
    const news = await getOrCreateCachedNews({
      era: session.era,
      locale: session.locale,
      tone: 'nostalgic',
      maxChars: 180,
      req,
      sourceItems: newsScriptToSourceItems(newsScript),
      newsScriptId: newsScript?.id,
      headline: newsScript?.title
    });
    const responsePayload = {
      sessionId: session.sessionId,
      sequence: session.sequence,
      playbackUnit: {
        news,
        track: toPlaybackTrack(nextTrack)
      }
    };
    rememberClientRequest(session, clientRequestId, responsePayload);
    return res.json(responsePayload);
  } catch (e) {
    return error(res, e.status || 500, e.code || 'INTERNAL_ERROR', e.message || 'internal error', e.details || {});
  }
});


app.get('/news-scripts', async (req, res) => {
  try {
    const filters = parseNewsScriptFilters(req.query);
    const [{ getDb }, { newsScripts }, { listNewsScripts }] = await Promise.all([
      import('./db/client.js'),
      import('./db/schema.js'),
      import('./newsScripts.js')
    ]);
    const items = await listNewsScripts(getDb(), newsScripts, filters);
    return res.json({ items, count: items.length, filters });
  } catch (e) {
    return error(res, e.status || 500, e.code || 'INTERNAL_ERROR', e.message || 'internal error', e.details || {});
  }
});

app.get('/news-scripts/random', async (req, res) => {
  try {
    const filters = parseNewsScriptFilters(req.query);
    const [{ getDb }, { newsScripts }, { getRandomNewsScript }] = await Promise.all([
      import('./db/client.js'),
      import('./db/schema.js'),
      import('./newsScripts.js')
    ]);
    const item = await getRandomNewsScript(getDb(), newsScripts, filters);
    if (!item) return error(res, 404, 'NEWS_SCRIPT_NOT_FOUND', 'news script not found', { filters });
    return res.json({ item, filters });
  } catch (e) {
    return error(res, e.status || 500, e.code || 'INTERNAL_ERROR', e.message || 'internal error', e.details || {});
  }
});

app.post('/news/script/generate', async (req, res) => {
  const { era, tone = 'warm', maxChars = 180, locale = 'ja-JP', sourceItems, llmProvider } = req.body || {};
  const normalizedEra = normalizeEra(era);
  if (!normalizedEra) return error(res, 400, 'INVALID_INPUT', 'era is required');

  try {
    const generated = await generateNewsScript({ era: normalizedEra, locale, tone, maxChars, sourceItems, llmProvider });
    return res.json(generated);
  } catch (e) {
    return error(res, e.status || 500, e.code || 'INTERNAL_ERROR', e.message || 'internal error', e.details || {});
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 8080;
  app.listen(port, () => {
    console.log(`airadio backend listening on :${port}`);
  });
}

export {
  app,
  buildNewsPrompt,
  calculateGeminiNewsThinkingBudget,
  calculateNewsOutputTokenBudget,
  buildScriptFromSource,
  extractGeminiText,
  extractOpenAiText,
  generateNewsScript,
  buildNewsCacheKey,
  ALLOWED_TRACK_ERAS,
  normalizeMaxChars,
  normalizeSourceItems,
  newsScriptToSourceItems,
  normalizeTtsAudioBuffer,
  parseAudioMimeType,
  resolveLlmProvider,
  sanitizeGeneratedScript,
  wrapPcm16leAsWav
};
