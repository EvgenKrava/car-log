import { TranscribeRequestSchema } from '@carlog/contracts';
import { CarNotFoundError, type CarRepository } from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import { TranscribeUnavailableError } from './transcribe-errors';
import type { TranscribeProvider } from './transcribe-provider';
import type { ApiEvent } from './router';

export type TranscribeDeps = { cars: CarRepository; transcriber: TranscribeProvider };

const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 60;

// Sanity-check the RIFF/WAVE header the client claims to have produced, and bound the
// DURATION (the base64 size cap alone doesn't: a lower claimed sample rate smuggles a
// longer clip). Returns the raw PCM (header stripped) or null when malformed.
//
// Chunks are NOT at fixed offsets — a real encoder can emit a `LIST`/`fact`/etc. chunk
// before `data` (or before `fmt `), which would silently mis-read hardcoded 36/40/44
// offsets. Walk the chunk headers instead: id at `off`, size at `off+4`, body at `off+8`,
// next chunk at `off+8+size` rounded up to an even boundary (RIFF chunks are word-aligned).
function pcmFromWav(buf: Buffer): Buffer | null {
  if (buf.length < 12) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;

  let fmtOk = false;
  let data: { offset: number; bytes: number } | null = null;

  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const bodyStart = off + 8;
    if (bodyStart + size > buf.length) return null; // declared chunk runs past the buffer

    if (id === 'fmt ') {
      if (size < 16) return null;
      const audioFormat = buf.readUInt16LE(bodyStart);
      const numChannels = buf.readUInt16LE(bodyStart + 2);
      const sampleRate = buf.readUInt32LE(bodyStart + 4);
      const bitsPerSample = buf.readUInt16LE(bodyStart + 14);
      if (audioFormat !== 1 || numChannels !== 1 || sampleRate !== SAMPLE_RATE || bitsPerSample !== 16) return null;
      fmtOk = true;
    } else if (id === 'data') {
      data = { offset: bodyStart, bytes: size };
    }
    off = bodyStart + size + (size % 2); // skip the pad byte on odd-sized chunks
  }

  if (!fmtOk || !data) return null;
  // The client caps recording at 60s, but interval-timer drift can land an honest full-length
  // hold a few ms over — tolerate 1s of that rather than discarding an otherwise-valid clip.
  if (data.bytes / (SAMPLE_RATE * 2) > MAX_SECONDS + 1) return null;
  return buf.subarray(data.offset, data.offset + data.bytes);
}

// Handles POST /cars/{carId}/chat/transcribe ; returns null if not matched.
// Audio is NEVER stored — decoded, transcribed, discarded.
export async function handleTranscribeRoute(
  deps: TranscribeDeps, event: ApiEvent, ownerId: string, carId: string,
): Promise<ApiResult | null> {
  if (event.path !== `/cars/${carId}/chat/transcribe` || event.method !== 'POST') return null;

  const car = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);

  const req = TranscribeRequestSchema.parse(event.body);
  const pcm = pcmFromWav(Buffer.from(req.audio, 'base64'));
  if (!pcm) return ok(400, { error: 'ValidationError', message: 'expected 16kHz mono 16-bit WAV, max 60s' });

  try {
    const text = await deps.transcriber.transcribe(pcm, req.language);
    return ok(200, { text });
  } catch (err) {
    if (err instanceof TranscribeUnavailableError) throw err;
    // Name + message only — never the audio, never anything from `req`/`pcm` — so an
    // unanticipated failure (e.g. a future TypeError) stays traceable in logs instead of
    // vanishing into an indistinguishable "temporarily unavailable" for every future bug.
    console.error('transcribe route failed', (err as Error).name, (err as Error).message);
    throw new TranscribeUnavailableError();
  }
}
