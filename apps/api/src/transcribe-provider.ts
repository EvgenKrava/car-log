import {
  TranscribeStreamingClient, StartStreamTranscriptionCommand,
} from '@aws-sdk/client-transcribe-streaming';
import { TranscribeUnavailableError } from './transcribe-errors';

export interface TranscribeProvider {
  transcribe(pcm: Buffer, language: 'uk-UA' | 'en-US'): Promise<string>;
}

const SAMPLE_RATE = 16_000;
const CHUNK_BYTES = 8 * 1024;
const CALL_TIMEOUT_MS = 25_000; // stay inside the ~29s Lambda / 30s API GW window

// Feed raw PCM (WAV header already stripped by the route) to Transcribe streaming and
// concatenate the FINAL (non-partial) result alternatives. The stream is fed faster
// than realtime; Transcribe keeps pace, so a 60s clip resolves in a few seconds.
export class AwsTranscribeProvider implements TranscribeProvider {
  private readonly client = new TranscribeStreamingClient({});

  async transcribe(pcm: Buffer, language: 'uk-UA' | 'en-US'): Promise<string> {
    async function* audioStream() {
      for (let off = 0; off < pcm.length; off += CHUNK_BYTES) {
        yield { AudioEvent: { AudioChunk: pcm.subarray(off, off + CHUNK_BYTES) } };
      }
    }
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new TranscribeUnavailableError('transcription timed out')), CALL_TIMEOUT_MS).unref?.();
    });
    try {
      const run = (async () => {
        const res = await this.client.send(new StartStreamTranscriptionCommand({
          LanguageCode: language,
          MediaEncoding: 'pcm',
          MediaSampleRateHertz: SAMPLE_RATE,
          AudioStream: audioStream(),
        }));
        const parts: string[] = [];
        for await (const evt of res.TranscriptResultStream ?? []) {
          for (const r of evt.TranscriptEvent?.Transcript?.Results ?? []) {
            if (!r.IsPartial && r.Alternatives?.[0]?.Transcript) parts.push(r.Alternatives[0].Transcript);
          }
        }
        return parts.join(' ').trim();
      })();
      return await Promise.race([run, timeout]);
    } catch (err) {
      if (err instanceof TranscribeUnavailableError) throw err;
      const e = err as Error;
      console.error('Transcribe failed', e.name, e.message); // no audio, no credentials logged
      throw new TranscribeUnavailableError();
    }
  }
}
