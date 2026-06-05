import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNewsPrompt,
  calculateNewsOutputTokenBudget,
  extractGeminiText,
  extractOpenAiText,
  generateNewsScript,
  normalizeMaxChars,
  normalizeSourceItems,
  normalizeTtsAudioBuffer,
  parseAudioMimeType,
  resolveLlmProvider,
  sanitizeGeneratedScript,
  wrapPcm16leAsWav
} from '../src/server.js';
import { parseNewsScriptFilters } from '../src/newsScriptFilters.js';

test('parses news script filter query parameters', () => {
  assert.deepEqual(parseNewsScriptFilters({ year: '1995', month: '6', category: ' technology ' }), {
    year: 1995,
    month: 6,
    category: 'technology'
  });
  assert.throws(() => parseNewsScriptFilters({ month: '13' }), /month must be an integer/);
  assert.throws(() => parseNewsScriptFilters({ category: '   ' }), /category must not be empty/);
});

test('normalizes maxChars into the supported range', () => {
  assert.equal(normalizeMaxChars(undefined), 180);
  assert.equal(normalizeMaxChars(20), 40);
  assert.equal(normalizeMaxChars(301), 300);
  assert.equal(normalizeMaxChars('120.8'), 120);
});


test('calculates output token budget from maxChars with a minimum floor', () => {
  assert.equal(calculateNewsOutputTokenBudget(40), 256);
  assert.equal(calculateNewsOutputTokenBudget(102), 256);
  assert.equal(calculateNewsOutputTokenBudget(103), 258);
  assert.equal(calculateNewsOutputTokenBudget(300), 750);
});

test('normalizes custom source items and drops incomplete entries', () => {
  assert.deepEqual(
    normalizeSourceItems([
      { title: '  国内景気  ', summary: '  個人消費が拡大  ', date: '1987-11-20' },
      { title: 'summary missing' },
      { summary: 'title missing' }
    ]),
    [{ title: '国内景気', summary: '個人消費が拡大', date: '1987-11-20' }]
  );
});

test('resolves auto provider from available API keys', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalLlmProvider = process.env.LLM_PROVIDER;
  try {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_PROVIDER;
    assert.equal(resolveLlmProvider(), 'template');

    process.env.GEMINI_API_KEY = 'gemini-key';
    assert.equal(resolveLlmProvider('auto'), 'gemini');

    process.env.OPENAI_API_KEY = 'openai-key';
    assert.equal(resolveLlmProvider('auto'), 'openai');
  } finally {
    setOrDeleteEnv('OPENAI_API_KEY', originalOpenAiKey);
    setOrDeleteEnv('GEMINI_API_KEY', originalGeminiKey);
    setOrDeleteEnv('LLM_PROVIDER', originalLlmProvider);
  }
});

test('builds a constrained Japanese radio news prompt', () => {
  const prompt = buildNewsPrompt({
    era: '1990s',
    locale: 'ja-JP',
    tone: 'warm',
    maxChars: 120,
    sourceItems: [{ title: 'インターネット普及', summary: '家庭向け回線が広がった', date: '1995-06-01' }]
  });

  assert.match(prompt, /120文字以内/);
  assert.match(prompt, /インターネット普及/);
  assert.match(prompt, /ニュース原稿本文だけ/);
});

test('extracts text from OpenAI Responses and Gemini payloads', () => {
  assert.equal(
    extractOpenAiText({ output: [{ content: [{ type: 'output_text', text: 'OpenAI原稿' }] }] }),
    'OpenAI原稿'
  );
  assert.equal(
    extractGeminiText({ candidates: [{ content: { parts: [{ text: 'Gemini原稿' }] } }] }),
    'Gemini原稿'
  );
});

test('sanitizes generated script for single-line playback', () => {
  assert.equal(sanitizeGeneratedScript('「ここで\nニュースです。」', 100), 'ここで ニュースです。');
  assert.equal(sanitizeGeneratedScript('1234567890', 4), '1234');
});

test('generates a bounded template fallback script without API keys', async () => {
  const generated = await generateNewsScript({
    era: '1980s',
    tone: 'warm',
    maxChars: 80,
    llmProvider: 'template',
    sourceItems: [{ title: '国内景気', summary: '個人消費が拡大しました。', date: '1987-11-20' }]
  });

  assert.equal(generated.provider, 'template');
  assert.equal(generated.model, 'local-template');
  assert.equal(generated.generatedByFallback, true);
  assert.ok(generated.script.length <= 80);
  assert.match(generated.script, /国内景気/);
});

test('detects Gemini PCM audio mime type and sample rate', () => {
  assert.deepEqual(
    parseAudioMimeType('audio/L16;codec=pcm;rate=24000'),
    { format: 'pcm', mimeType: 'audio/l16;codec=pcm;rate=24000', sampleRateHz: 24000 }
  );
});

test('wraps PCM TTS bytes as a WAV file for ExoPlayer playback', () => {
  const wav = wrapPcm16leAsWav(Buffer.from([0x00, 0x00, 0xff, 0x7f]), { sampleRateHz: 24000 });

  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), 4);
  assert.equal(wav.length, 48);
});

test('normalizes Gemini TTS PCM payloads to wav audio assets', () => {
  const normalized = normalizeTtsAudioBuffer(
    Buffer.from([0x00, 0x00, 0xff, 0x7f]),
    'audio/L16;codec=pcm;rate=24000'
  );

  assert.equal(normalized.format, 'wav');
  assert.equal(normalized.mimeType, 'audio/wav');
  assert.equal(normalized.buffer.toString('ascii', 0, 4), 'RIFF');
});

function setOrDeleteEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
