import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDbNewsInterludeScript,
  buildDbTopicSourceItem,
  buildNewsPrompt,
  extractGeminiText,
  extractOpenAiText,
  generateNewsScript,
  generateNewsScriptFromTopic,
  isUsableGeneratedNewsScript,
  mergeEraIntoNewsFilters,
  normalizeMaxChars,
  normalizeSourceItems,
  normalizeTtsAudioBuffer,
  parseAudioMimeType,
  parseEraYearRange,
  resolveLlmProvider,
  truncateAtSentenceBoundary,
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
  assert.deepEqual(parseNewsScriptFilters({ yearStart: '1980', yearEnd: '1989' }), {
    yearStart: 1980,
    yearEnd: 1989
  });
  assert.throws(() => parseNewsScriptFilters({ yearStart: '1999', yearEnd: '1990' }), /yearStart must be less than or equal to yearEnd/);
  assert.throws(() => parseNewsScriptFilters({ month: '13' }), /month must be an integer/);
  assert.throws(() => parseNewsScriptFilters({ category: '   ' }), /category must not be empty/);
});


test('maps era labels to news script year ranges unless explicit filters exist', () => {
  assert.deepEqual(parseEraYearRange('1980s'), { yearStart: 1980, yearEnd: 1989 });
  assert.equal(parseEraYearRange('eighties'), null);
  assert.deepEqual(mergeEraIntoNewsFilters({}, '1990s'), { yearStart: 1990, yearEnd: 1999 });
  assert.deepEqual(mergeEraIntoNewsFilters({ year: 1995 }, '1990s'), { year: 1995 });
});

test('normalizes maxChars into the supported range', () => {
  assert.equal(normalizeMaxChars(undefined), 180);
  assert.equal(normalizeMaxChars(20), 40);
  assert.equal(normalizeMaxChars(501), 500);
  assert.equal(normalizeMaxChars(301), 301);
  assert.equal(normalizeMaxChars('120.8'), 120);
});

test('normalizes custom source items and drops incomplete entries', () => {
  assert.deepEqual(
    normalizeSourceItems([
      { title: '  国内景気  ', summary: '  個人消費が拡大  ', date: '1987-11-20' },
      { title: 'summary missing' },
      { summary: 'title missing' }
    ]),
    [{ title: '国内景気', summary: '個人消費が拡大', detail: '', date: '1987-11-20', category: '' }]
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
  assert.match(prompt, /トピック/);
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
  assert.equal(sanitizeGeneratedScript('さて、ここで一つ、ちょっと気になるお話', 100), 'さて、ここで一つ、ちょっと気になるお話。');
  assert.equal(sanitizeGeneratedScript('1234567890', 4), '1234');
});

test('truncates long generated scripts at sentence boundaries', () => {
  const script = '第一文です。第二文は少し長めの説明です。第三文はここで切られます。';
  assert.equal(truncateAtSentenceBoundary(script, 14), '第一文です。');
  assert.equal(isUsableGeneratedNewsScript('短いニュース。'), false);
  assert.equal(isUsableGeneratedNewsScript('これは十分な長さのニュース原稿です。'.repeat(8)), true);
});



test('builds an LLM source item from a database topic', () => {
  assert.deepEqual(buildDbTopicSourceItem({
    title: 'ブロードバンドの一般化',
    summary: '高速通信が広がりました。',
    scriptText: '動画や音楽配信が身近になりました。',
    date: '2004-09-10T00:00:00.000Z',
    category: 'technology',
    type: 'historical'
  }), {
    title: 'ブロードバンドの一般化',
    summary: '高速通信が広がりました。',
    detail: '動画や音楽配信が身近になりました。',
    date: '2004-09-10',
    category: 'technology'
  });
});

test('builds a fuller database news interlude script for display and TTS', () => {
  const script = buildDbNewsInterludeScript({
    title: 'インターネット普及のはじまり',
    summary: '家庭向け回線の普及で情報アクセスが広がりました。',
    scriptText: '電話回線の先につながる新しい世界に、ニュースも音楽もメールも、少しずつ身近な存在になっていきました。',
    year: 1995,
    month: 6
  }, '1990s');

  assert.match(script, /1990sから、1995年6月のニュースです/);
  assert.match(script, /家庭向け回線/);
  assert.match(script, /次の曲へまいりましょう/);
  assert.ok(script.length > 100);
});


test('falls back to a fuller database topic script when no LLM is available', async () => {
  const generated = await generateNewsScriptFromTopic({
    era: '2000s',
    llmProvider: 'template',
    topic: {
      id: 'topic-2004',
      title: 'ブロードバンドの一般化',
      summary: '高速通信の普及でネット動画や音楽配信が日常に近づきました。',
      scriptText: 'ADSLや光回線の広がりによって、待ち時間の長かったインターネット体験は大きく変わりました。家で動画を見たり、音楽を探したりする楽しみが増えました。',
      date: '2004-09-10T00:00:00.000Z',
      year: 2004,
      month: 9,
      category: 'technology',
      type: 'historical'
    }
  });

  assert.equal(generated.newsId, 'topic-2004');
  assert.equal(generated.provider, 'template');
  assert.equal(generated.model, 'db-topic-fallback');
  assert.equal(generated.generatedByFallback, true);
  assert.match(generated.script, /2000sから、2004年9月のニュースです/);
  assert.match(generated.script, /次の曲へまいりましょう/);
  assert.ok(generated.script.length > 130);
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
