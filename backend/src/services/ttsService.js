export class TtsService {
  synthesize({ era, sequence, newsId, script }) {
    const durationSec = Math.max(8, Math.ceil(script.length / 8));
    return {
      url: `https://cdn.example.com/tts/${era}_${sequence}_${newsId}.mp3`,
      format: 'mp3',
      durationSec
    };
  }
}
