export class NewsScriptService {
  constructor({ providerAdapter }) {
    this.providerAdapter = providerAdapter;
  }

  generate({ era, tone = 'warm', maxChars = 180, sourceItems = [] }) {
    const source = Array.isArray(sourceItems) ? sourceItems[0] : null;
    const basePrompt = source?.title
      ? `${source.title}について`
      : `${era}を振り返る話題として`;

    const generated = this.providerAdapter.generateShortNews({
      era,
      tone,
      maxChars,
      basePrompt
    });

    return {
      ...generated,
      tone
    };
  }
}
