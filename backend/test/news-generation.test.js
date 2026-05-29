import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNewsPrompt,
  extractGeminiText,
  extractOpenAiText,
  generateNewsScript,
  normalizeMaxChars,
  normalizeSourceItems,
  resolveLlmProvider,
  sanitizeGeneratedScript
} from '../src/server.js';

test('normalizes maxChars into the supported range', () => {
  assert.equal(normalizeMaxChars(undefined), 180);
  assert.equal(normalizeMaxChars(20), 40);
  assert.equal(normalizeMaxChars(301), 300);
  assert.equal(normalizeMaxChars('120.8'), 120);
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

function setOrDeleteEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
