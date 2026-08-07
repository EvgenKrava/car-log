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

  it('rejects a clip over 60s with 400 (duration check, not just size)', async () => {
    // 8kHz trick: small payload, long duration — the size cap alone would pass it.
    const transcriber = new InMemoryTranscribeProvider('x');
    const res = await handleTranscribeRoute({ cars, transcriber }, post({ audio: wavBase64(61, 8_000), language: 'uk-UA' }), OWNER, CAR_ID);
    expect(res?.statusCode).toBe(400);
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
