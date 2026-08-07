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
function pcmFromWav(buf: Buffer): Buffer | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  if (buf.readUInt16LE(20) !== 1 || buf.readUInt16LE(22) !== 1) return null; // PCM, mono
  if (buf.readUInt32LE(24) !== SAMPLE_RATE || buf.readUInt16LE(34) !== 16) return null;
  const dataBytes = buf.readUInt32LE(40);
  if (44 + dataBytes > buf.length) return null;
  if (dataBytes / (SAMPLE_RATE * 2) > MAX_SECONDS) return null;
  return buf.subarray(44, 44 + dataBytes);
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
    throw new TranscribeUnavailableError();
  }
}
