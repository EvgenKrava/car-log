import { describe, expect, it, beforeEach } from 'vitest';
import type { Car } from '@carlog/contracts';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryTranscribeProvider } from './in-memory-transcribe-provider';
import { handleTranscribeRoute } from './transcribe-route';
import { TranscribeUnavailableError } from './transcribe-errors';
import type { ApiEvent } from './router';

const OWNER = 'owner-1';
const CAR_ID = '33333333-3333-4333-8333-333333333333';
const car: Car = {
  id: CAR_ID, ownerId: OWNER, make: 'VW', model: 'Golf', year: 2018, mileage: 90000,
  fuelType: 'diesel', engineVolume: undefined, nickname: undefined, vin: undefined,
  licensePlate: undefined, createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z', shared: false,
};

// Minimal valid 16kHz mono 16-bit WAV: 44-byte header + 1s of silence.
function wavBase64(seconds = 1, sampleRate = 16_000): string {
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
  return buf.toString('base64');
}

// A legal WAV with an extra `LIST` metadata chunk (as real encoders emit, e.g. an INFO
// list) sitting BEFORE `data` — exercises the RIFF chunk walk instead of the hardcoded
// 36/40/44 offsets. Body is an odd length on purpose to also exercise the chunk
// word-alignment pad byte.
function wavWithListChunkBase64(seconds = 1, sampleRate = 16_000): { b64: string; dataBytes: number } {
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const listBody = Buffer.from('INFOodd!'.slice(0, 7)); // 7 bytes: odd length
  const listBodyPadded = listBody.length + (listBody.length % 2);
  const fmtChunkLen = 8 + 16;
  const listChunkLen = 8 + listBodyPadded;
  const dataChunkLen = 8 + dataBytes + (dataBytes % 2);
  const riffSize = 4 + fmtChunkLen + listChunkLen + dataChunkLen; // bytes after the RIFF size field
  const buf = Buffer.alloc(8 + riffSize);
  let off = 0;
  buf.write('RIFF', off); off += 4;
  buf.writeUInt32LE(riffSize, off); off += 4;
  buf.write('WAVE', off); off += 4;
  buf.write('fmt ', off); off += 4;
  buf.writeUInt32LE(16, off); off += 4;
  buf.writeUInt16LE(1, off); off += 2; // PCM
  buf.writeUInt16LE(1, off); off += 2; // mono
  buf.writeUInt32LE(sampleRate, off); off += 4;
  buf.writeUInt32LE(sampleRate * 2, off); off += 4;
  buf.writeUInt16LE(2, off); off += 2;
  buf.writeUInt16LE(16, off); off += 2;
  buf.write('LIST', off); off += 4;
  buf.writeUInt32LE(listBody.length, off); off += 4;
  listBody.copy(buf, off); off += listBody.length;
  if (listBody.length % 2 === 1) off += 1; // pad byte, left zeroed by Buffer.alloc
  buf.write('data', off); off += 4;
  buf.writeUInt32LE(dataBytes, off); off += 4;
  // off + dataBytes is left zero-filled by Buffer.alloc — content doesn't matter, only length.
  return { b64: buf.toString('base64'), dataBytes };
}

const post = (body: unknown, carId = CAR_ID): ApiEvent => ({
  method: 'POST', path: `/cars/${carId}/chat/transcribe`, ownerId: OWNER, groups: [],
  pathParams: { id: carId }, queryParams: {}, body,
});

describe('POST /cars/{id}/chat/transcribe', () => {
  let cars: InMemoryCarRepository;
  beforeEach(async () => { cars = new InMemoryCarRepository(); await cars.create(car); });

  it('transcribes a valid clip', async () => {
    const transcriber = new InMemoryTranscribeProvider('замінив оливу');
    const res = await handleTranscribeRoute({ cars, transcriber }, post({ audio: wavBase64(), language: 'uk-UA' }), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res!.body)).toEqual({ text: 'замінив оливу' });
    expect(transcriber.lastLanguage).toBe('uk-UA');
    expect(transcriber.lastPcmBytes).toBe(32_000); // 1s of 16kHz 16-bit, header stripped
  });

  it('rejects a non-WAV payload with 400', async () => {
    const transcriber = new InMemoryTranscribeProvider('x');
    const res = await handleTranscribeRoute({ cars, transcriber }, post({ audio: Buffer.from('not a wav').toString('base64'), language: 'uk-UA' }), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(400);
  });

  it('rejects a clip over the 61s tolerance with 400 (duration check, not just size)', async () => {
    // 8kHz trick: small payload, long duration — the size cap alone would pass it. 62s
    // clears even the +1s drift tolerance (MAX_SECONDS=60), so this must still 400.
    const transcriber = new InMemoryTranscribeProvider('x');
    const res = await handleTranscribeRoute({ cars, transcriber }, post({ audio: wavBase64(62, 8_000), language: 'uk-UA' }), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(400);
  });

  it('accepts a 60.5s clip (interval-timer drift over the 60s cap tolerated)', async () => {
    const transcriber = new InMemoryTranscribeProvider('ok');
    const res = await handleTranscribeRoute({ cars, transcriber }, post({ audio: wavBase64(60.5), language: 'uk-UA' }), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(200);
    expect(transcriber.lastPcmBytes).toBe(Math.round(60.5 * 16_000) * 2);
  });

  it('transcribes the real PCM length from a WAV with a LIST chunk before data', async () => {
    const { b64, dataBytes } = wavWithListChunkBase64(2);
    const transcriber = new InMemoryTranscribeProvider('замінив оливу');
    const res = await handleTranscribeRoute({ cars, transcriber }, post({ audio: b64, language: 'uk-UA' }), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res!.body)).toEqual({ text: 'замінив оливу' });
    // Proves the chunk walk found the REAL `data` chunk (after `LIST`), not 4 garbage
    // bytes read from a hardcoded offset that would have landed inside the LIST chunk.
    expect(transcriber.lastPcmBytes).toBe(dataBytes);
  });

  it('maps provider failure to TranscribeUnavailableError (503 via error handling)', async () => {
    const transcriber = new InMemoryTranscribeProvider('x', new Error('aws down'));
    await expect(
      handleTranscribeRoute({ cars, transcriber }, post({ audio: wavBase64(), language: 'uk-UA' }), OWNER, CAR_ID),
    ).rejects.toBeInstanceOf(TranscribeUnavailableError);
  });

  it('404s a foreign car', async () => {
    const transcriber = new InMemoryTranscribeProvider('x');
    await expect(
      handleTranscribeRoute({ cars, transcriber }, post({ audio: wavBase64(), language: 'uk-UA' }, '99999999-9999-4999-8999-999999999999'), OWNER, '99999999-9999-4999-8999-999999999999'),
    ).rejects.toThrow(); // CarNotFoundError
  });

  it('returns null for non-matching paths', async () => {
    const transcriber = new InMemoryTranscribeProvider('x');
    const res = await handleTranscribeRoute({ cars, transcriber }, { ...post({ audio: wavBase64(), language: 'uk-UA' }), path: `/cars/${CAR_ID}/chat/sessions` }, OWNER, CAR_ID);
    expect(res).toBeNull();
  });
});
