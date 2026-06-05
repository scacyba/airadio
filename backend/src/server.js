import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseNewsScriptFilters } from './newsScriptFilters.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const tracksCatalog = JSON.parse(fs.readFileSync(new URL('../data/tracks_catalog.json', import.meta.url)));
const sessions = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const audioOutputDir = path.resolve(__dirname, '../generated_audio');
fs.mkdirSync(audioOutputDir, { recursive: true });

const RADIO_NEWS_MAX_CHARS = 360;
const RADIO_NEWS_MIN_DURATION_SEC = 24;

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

function normalizeMaxChars(maxChars) {
  const parsed = Number(maxChars);
  if (!Number.isFinite(parsed)) return 180;
  return Math.min(500, Math.max(40, Math.trunc(parsed)));
}

function normalizeSourceItems(sourceItems) {
  if (!Array.isArray(sourceItems)) return [];
  return sourceItems
    .map((item) => ({
      title: String(item?.title || '').trim(),
      summary: String(item?.summary || '').trim(),
      detail: String(item?.detail || item?.scriptText || '').trim(),
      date: String(item?.date || '').trim(),
      category: String(item?.category || '').trim()
    }))
    .filter((item) => item.title && item.summary)
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
  let script = `${tonePrefix}、${src.date ? `${src.date}ごろ` : ''}${src.title}。${src.summary}`;
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

function buildNewsPrompt({ era, locale, tone, maxChars, sourceItems }) {
  const toneInstruction = tone === 'warm'
    ? 'やさしく親しみやすい口調'
    : '懐かしさを感じるラジオDJ風の口調';
  const sources = sourceItems.map((item, index) => (
    `${index + 1}. date=${item.date || 'unknown'} category=${item.category || 'unknown'} title=${item.title} summary=${item.summary}${item.detail ? ` detail=${item.detail}` : ''}`
  )).join('\n');

  return [
    'あなたは日本語ラジオ番組の曲間ニュース原稿ライターです。',
    `対象年代: ${era}`,
    `ロケール: ${locale}`,
    `口調: ${toneInstruction}`,
    `制約: ${maxChars}文字以内。ニュース原稿本文だけを出力。箇条書き、見出し、引用符、出典表記は不要。`,
    'DBのトピックを素材に、当時の背景や聞きどころを少し補い、曲間で自然に聴けるニュース風の原稿にしてください。',
    '公開可能な範囲の私的トピックが含まれる場合があります。個人を特定しすぎる表現や過度な断定は避け、温かく一般化してください。',
    'トピック:',
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

async function callOpenAiForNews(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY is required for OpenAI news generation');
    err.status = 503;
    err.code = 'LLM_PROVIDER_UNAVAILABLE';
    throw err;
  }

  const model = process.env.OPENAI_NEWS_MODEL || 'gpt-4.1-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 420,
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
  return { provider: 'openai', model, text: extractOpenAiText(payload), raw: payload };
}

async function callGeminiForNews(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is required for Gemini news generation');
    err.status = 503;
    err.code = 'LLM_PROVIDER_UNAVAILABLE';
    throw err;
  }

  const model = process.env.GEMINI_NEWS_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 420
      }
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

  return { provider: 'gemini', model, text: extractGeminiText(payload), raw: payload };
}

async function requestLlmNewsScript({ provider, prompt }) {
  if (provider === 'openai') return callOpenAiForNews(prompt);
  if (provider === 'gemini') return callGeminiForNews(prompt);
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
  const llmResult = await requestLlmNewsScript({ provider, prompt });
  const templateScript = buildScriptFromSource({ era, tone, maxChars: resolvedMaxChars, sourceItems: resolvedSourceItems });
  const sanitizedLlmScript = sanitizeGeneratedScript(llmResult.text, resolvedMaxChars);
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
    durationSec: estimateTtsDurationSec(script)
  };
}

function parseEraYearRange(era) {
  const match = String(era || '').trim().match(/^(\d{4})s$/);
  if (!match) return null;
  const start = Number(match[1]);
  return { yearStart: start, yearEnd: start + 9 };
}

function mergeEraIntoNewsFilters(filters = {}, era) {
  const range = parseEraYearRange(era);
  if (!range || filters.year !== undefined || filters.yearStart !== undefined || filters.yearEnd !== undefined) {
    return filters;
  }
  return { ...filters, ...range };
}

function estimateTtsDurationSec(script) {
  const charCount = String(script || '').replace(/\s+/g, '').length;
  return Math.max(RADIO_NEWS_MIN_DURATION_SEC, Math.ceil(charCount / 5));
}

function buildDbNewsInterludeScript(newsScript, era, maxChars = RADIO_NEWS_MAX_CHARS) {
  const dateLabel = [
    newsScript.year ? `${newsScript.year}年` : '',
    newsScript.month ? `${newsScript.month}月` : ''
  ].join('');
  const intro = `${era}から${dateLabel ? `、${dateLabel}` : ''}のニュースです。${newsScript.title}。`;
  const bodyParts = [newsScript.summary, newsScript.scriptText]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index);
  const outro = '当時の空気を思い浮かべながら、次の曲へまいりましょう。';
  return sanitizeGeneratedScript([intro, ...bodyParts, outro].join(' '), maxChars);
}

function buildDbTopicSourceItem(topic) {
  return {
    title: topic.title,
    summary: topic.summary,
    detail: topic.scriptText,
    date: topic.date ? topic.date.slice(0, 10) : '',
    category: topic.category || topic.type || ''
  };
}

async function generateNewsScriptFromTopic({ topic, era, locale = 'ja-JP', tone = 'nostalgic', maxChars = RADIO_NEWS_MAX_CHARS, llmProvider }) {
  const sourceItems = [buildDbTopicSourceItem(topic)];
  const fallbackScript = buildDbNewsInterludeScript(topic, era, maxChars);

  try {
    const generated = await generateNewsScript({ era, locale, tone, maxChars, sourceItems, llmProvider });
    if (generated.generatedByFallback) {
      return {
        newsId: topic.id,
        provider: 'template',
        model: 'db-topic-fallback',
        script: fallbackScript,
        charCount: fallbackScript.length,
        sourceItems,
        safety: { blocked: false, categories: [] },
        generatedByFallback: true,
        fallbackReason: 'llm returned empty script'
      };
    }

    return {
      ...generated,
      newsId: topic.id,
      sourceItems,
      fallbackReason: null
    };
  } catch (e) {
    if (e.code !== 'LLM_PROVIDER_UNAVAILABLE' && e.code !== 'SAFETY_BLOCKED') throw e;
    return {
      newsId: topic.id,
      provider: 'template',
      model: 'db-topic-fallback',
      script: fallbackScript,
      charCount: fallbackScript.length,
      sourceItems,
      safety: { blocked: false, categories: [] },
      generatedByFallback: true,
      fallbackReason: e.code
    };
  }
}

async function getRandomDbNewsForEra({ era, req }) {
  const filters = mergeEraIntoNewsFilters({}, era);
  const [{ getDb }, { newsScripts }, { getRandomNewsScript }] = await Promise.all([
    import('./db/client.js'),
    import('./db/schema.js'),
    import('./newsScripts.js')
  ]);
  const item = await getRandomNewsScript(getDb(), newsScripts, filters);
  if (!item) {
    const err = new Error('news script not found for era');
    err.status = 404;
    err.code = 'NEWS_SCRIPT_NOT_FOUND';
    err.details = { era, filters };
    throw err;
  }

  const generated = await generateNewsScriptFromTopic({ topic: item, era, maxChars: RADIO_NEWS_MAX_CHARS });
  const audio = await synthesizeNewsAudio({ newsId: item.id, script: generated.script, req });
  return {
    newsId: item.id,
    headline: item.title,
    script: generated.script,
    charCount: generated.charCount,
    audio,
    provider: generated.provider,
    model: generated.model,
    generatedByFallback: generated.generatedByFallback,
    source: {
      type: item.type,
      year: item.year,
      month: item.month,
      category: item.category,
      source: item.source,
      sourceUrl: item.sourceUrl
    }
  };
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
    policy: { maxNewsChars: RADIO_NEWS_MAX_CHARS, safeMode: true }
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
    const news = await getRandomDbNewsForEra({ era: session.era, req });
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


app.get('/news-scripts', async (req, res) => {
  try {
    const filters = mergeEraIntoNewsFilters(parseNewsScriptFilters(req.query), req.query.era);
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
    const filters = mergeEraIntoNewsFilters(parseNewsScriptFilters(req.query), req.query.era);
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
  buildDbNewsInterludeScript,
  buildDbTopicSourceItem,
  buildNewsPrompt,
  buildScriptFromSource,
  extractGeminiText,
  extractOpenAiText,
  generateNewsScript,
  generateNewsScriptFromTopic,
  mergeEraIntoNewsFilters,
  normalizeMaxChars,
  normalizeSourceItems,
  normalizeTtsAudioBuffer,
  parseAudioMimeType,
  parseEraYearRange,
  resolveLlmProvider,
  sanitizeGeneratedScript,
  wrapPcm16leAsWav
};
