export class GeminiAdapter {
  constructor({ model = 'gemini-2.5-flash' } = {}) {
    this.model = model;
  }

  generateShortNews({ era, tone, maxChars, basePrompt }) {
    let script = `${basePrompt}、${era}の空気感を思い出せる${tone}な短いニュースをお届けします。`;
    if (script.length > maxChars) script = script.slice(0, maxChars);

    return {
      provider: 'gemini',
      model: this.model,
      script,
      charCount: script.length,
      safety: { blocked: false, categories: [] }
    };
  }
}
