import type { TranscribeProvider } from './transcribe-provider';

// Deterministic fake: returns the configured text, records what it was fed.
export class InMemoryTranscribeProvider implements TranscribeProvider {
  lastLanguage: string | null = null;
  lastPcmBytes: number | null = null;
  constructor(private readonly text: string, private readonly throwErr?: Error) {}
  async transcribe(pcm: Buffer, language: 'uk-UA' | 'en-US'): Promise<string> {
    if (this.throwErr) throw this.throwErr;
    this.lastLanguage = language;
    this.lastPcmBytes = pcm.length;
    return this.text;
  }
}
