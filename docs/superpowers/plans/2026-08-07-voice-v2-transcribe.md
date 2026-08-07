# Voice Input v2 (Hold-to-Record + Transcribe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Web Speech dictation with hold-to-record → client-side 16kHz WAV encode → `POST /cars/{id}/chat/transcribe` → Amazon Transcribe streaming → editable text in the composer.

**Architecture:** A pure WAV encoder + a `useVoiceRecorder` hook (MediaRecorder + AnalyserNode) on the web; one authed route with a `TranscribeProvider` port (AWS impl + in-memory fake) on the API; a recording-bar composer UI with hold/slide-cancel gestures. Audio never persists — POST body only.

**Tech Stack:** MediaRecorder/AudioContext, `@aws-sdk/client-transcribe-streaming` (new, apps/api only), Zod, MUI, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-07-voice-v2-transcribe-design.md` is authoritative. Verified fact: Transcribe streaming accepts `pcm | ogg-opus | flac` ONLY; iOS records mp4/AAC — hence the client-side PCM WAV re-encode.
- WAV: 16 000 Hz, mono, 16-bit LE PCM, 44-byte RIFF header. Cap **60s** per clip (client + contract + route duration check).
- Contract: `audio` base64 max 2 800 000 chars; `language: z.enum(['uk-UA','en-US'])`; response `{ text }`.
- Never auto-send transcribed text; append to the input, preserve typed text.
- Audio is never stored (no S3, no Dynamo) — memory only.
- Errors: new `TranscribeUnavailableError` → 503 (mirror `LlmUnavailableError` in `errors.ts`); bad RIFF/duration → 400; foreign car → 404.
- Web Speech fallback stays behind the same mic when MediaRecorder is unsupported; live-typing/readOnly behavior removed.
- Strict TS never `any`; MUI only; i18n en+uk symmetric; no TODO/stubs; trailing newline; conventional commits NO trailers; gates `pnpm turbo run build lint typecheck test` per task.
- Branch: `feat/voice-v2-transcribe`.
- **IAM note:** the Transcribe streaming action name must be verified empirically at deploy (docs disagree: `transcribe:StartStreamTranscription` vs `transcribestreaming:*`). The deploy task includes a live probe.

---

## File Structure

- `apps/web/src/lib/wav-encode.ts` (+test) — pure encoder.
- `apps/web/src/lib/useVoiceRecorder.ts` — recorder hook (MediaRecorder + level meter + 60s cap).
- `apps/web/src/lib/hold-gesture.ts` (+test) — pure press/hold/slide state reducer.
- `packages/contracts/src/chat.ts` (+test) — `TranscribeRequestSchema`/`TranscribeResponseSchema`.
- `apps/api/src/transcribe-provider.ts` — port + `AwsTranscribeProvider`.
- `apps/api/src/transcribe-errors.ts` — `TranscribeUnavailableError`.
- `apps/api/src/transcribe-route.ts` (+test) — the route (RIFF sanity, ownership, provider call).
- `apps/api/src/in-memory-transcribe-provider.ts` — fake.
- `apps/api/src/errors.ts`, `router.ts`, `handler.ts` (modify) — mapping + wiring.
- `infrastructure/cdk/lib/carlog-stack.ts` (modify) — route + IAM.
- `apps/web/src/components/chat/RecordingBar.tsx` — the transformed composer row.
- `apps/web/src/components/chat/VoiceComposerButton.tsx`, `routes/ChatConversation.tsx` (modify) — gesture wiring, fallback path.
- `apps/web/src/api-client.ts`, i18n `{en,uk}/chat.json` (modify).

---

### Task 1: WAV encoder + hold-gesture reducer (pure, TDD)

**Files:**
- Create: `apps/web/src/lib/wav-encode.ts`, `apps/web/src/lib/wav-encode.test.ts`
- Create: `apps/web/src/lib/hold-gesture.ts`, `apps/web/src/lib/hold-gesture.test.ts`

**Interfaces:**
- Produces: `encodeWav16kMono(input: { channels: Float32Array[]; sampleRate: number }): ArrayBuffer` — takes raw channel data (NOT an AudioBuffer — jsdom has none; the hook adapts `AudioBuffer` → this shape at the call site). `WAV_SAMPLE_RATE = 16000`, `MAX_CLIP_SECONDS = 60`.
- Produces: `holdGestureReducer(state: HoldState, event: HoldEvent): HoldState` with
  `type HoldState = { phase: 'idle'|'pressed'|'recording'|'cancelling' ; startedAt: number; dx: number }`,
  `type HoldEvent = { kind: 'down'; at: number } | { kind: 'move'; dx: number } | { kind: 'up'; at: number } | { kind: 'holdTimer' } | { kind: 'reset' }`,
  plus `HOLD_THRESHOLD_MS = 300`, `CANCEL_SLIDE_PX = 72`, and
  `holdOutcome(state: HoldState, event: HoldEvent): 'record'|'cancel'|'hint'|null` describing what an `up` means.

- [ ] **Step 1: Failing WAV tests**

Create `apps/web/src/lib/wav-encode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { encodeWav16kMono, WAV_SAMPLE_RATE } from './wav-encode';

// 1s stereo sine at 48kHz: L = sin, R = 0 → mono average = sin/2.
const sine48k = (): { channels: Float32Array[]; sampleRate: number } => {
  const n = 48_000;
  const left = new Float32Array(n);
  for (let i = 0; i < n; i += 1) left[i] = Math.sin((2 * Math.PI * 440 * i) / n);
  return { channels: [left, new Float32Array(n)], sampleRate: 48_000 };
};

const view = (buf: ArrayBuffer) => new DataView(buf);
const ascii = (buf: ArrayBuffer, off: number, len: number) =>
  String.fromCharCode(...new Uint8Array(buf, off, len));

describe('encodeWav16kMono', () => {
  it('writes a valid 44-byte RIFF/WAVE header for 16kHz mono 16-bit', () => {
    const wav = encodeWav16kMono(sine48k());
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    const v = view(wav);
    expect(v.getUint16(20, true)).toBe(1);              // PCM
    expect(v.getUint16(22, true)).toBe(1);              // mono
    expect(v.getUint32(24, true)).toBe(WAV_SAMPLE_RATE); // 16000
    expect(v.getUint16(34, true)).toBe(16);             // bits/sample
    expect(ascii(wav, 36, 4)).toBe('data');
  });

  it('downsamples 48kHz → 16kHz (1s in = 16000 samples out)', () => {
    const wav = encodeWav16kMono(sine48k());
    const dataBytes = view(wav).getUint32(40, true);
    expect(dataBytes / 2).toBe(16_000); // 16-bit samples
    expect(wav.byteLength).toBe(44 + dataBytes);
  });

  it('averages channels to mono (stereo sin+silence → half amplitude)', () => {
    const wav = encodeWav16kMono(sine48k());
    const v = view(wav);
    let peak = 0;
    for (let i = 0; i < 16_000; i += 1) {
      peak = Math.max(peak, Math.abs(v.getInt16(44 + i * 2, true)));
    }
    expect(peak).toBeGreaterThan(0.45 * 32_767);
    expect(peak).toBeLessThan(0.55 * 32_767); // ~0.5 = sin/2
  });

  it('clamps out-of-range floats instead of overflowing', () => {
    const loud = { channels: [new Float32Array([2, -2, 1, -1])], sampleRate: 16_000 };
    const wav = encodeWav16kMono(loud);
    const v = view(wav);
    expect(v.getInt16(44, true)).toBe(32_767);
    expect(v.getInt16(46, true)).toBe(-32_768);
  });
});
```

- [ ] **Step 2: Run to fail** — `pnpm --filter @carlog/web test src/lib/wav-encode.test.ts` → module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/wav-encode.ts`:

```ts
// Transcribe streaming accepts pcm|ogg-opus|flac ONLY, while browsers record webm/opus
// (Chrome) or mp4/AAC (iOS Safari). So we re-encode client-side: average to mono,
// linear-resample to 16kHz, 16-bit LE PCM with a standard 44-byte RIFF header.
// Takes raw channel data rather than an AudioBuffer so it is testable without a DOM.
export const WAV_SAMPLE_RATE = 16_000;
export const MAX_CLIP_SECONDS = 60;

export function encodeWav16kMono(
  input: { channels: Float32Array[]; sampleRate: number },
): ArrayBuffer {
  const { channels, sampleRate } = input;
  const srcLen = channels[0]?.length ?? 0;

  // Average all channels to mono.
  const mono = new Float32Array(srcLen);
  for (const ch of channels) {
    for (let i = 0; i < srcLen; i += 1) mono[i]! += ch[i]! / channels.length;
  }

  // Linear resample to 16kHz.
  const outLen = Math.round((srcLen * WAV_SAMPLE_RATE) / sampleRate);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const pos = (i * sampleRate) / WAV_SAMPLE_RATE;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, srcLen - 1);
    const frac = pos - lo;
    out[i] = (mono[lo] ?? 0) * (1 - frac) + (mono[hi] ?? 0) * frac;
  }

  // 16-bit PCM + RIFF header.
  const dataBytes = outLen * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const writeAscii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);                       // PCM
  v.setUint16(22, 1, true);                       // mono
  v.setUint32(24, WAV_SAMPLE_RATE, true);
  v.setUint32(28, WAV_SAMPLE_RATE * 2, true);     // byte rate
  v.setUint16(32, 2, true);                       // block align
  v.setUint16(34, 16, true);                      // bits/sample
  writeAscii(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < outLen; i += 1) {
    const s = Math.max(-1, Math.min(1, out[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 32_768 : s * 32_767, true);
  }
  return buf;
}
```

- [ ] **Step 4: Run to pass** — 4 cases green.

- [ ] **Step 5: Failing gesture tests**

Create `apps/web/src/lib/hold-gesture.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  holdGestureReducer, holdOutcome, initialHoldState,
  HOLD_THRESHOLD_MS, CANCEL_SLIDE_PX, type HoldState,
} from './hold-gesture';

const down = (at = 0) => ({ kind: 'down', at } as const);
const up = (at: number) => ({ kind: 'up', at } as const);

describe('holdGestureReducer', () => {
  it('short press yields a hint, not a recording', () => {
    let s: HoldState = holdGestureReducer(initialHoldState, down(0));
    expect(s.phase).toBe('pressed');
    const ev = up(HOLD_THRESHOLD_MS - 1);
    expect(holdOutcome(s, ev)).toBe('hint');
    s = holdGestureReducer(s, ev);
    expect(s.phase).toBe('idle');
  });

  it('holdTimer promotes pressed → recording; release records', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    expect(s.phase).toBe('recording');
    expect(holdOutcome(s, up(5_000))).toBe('record');
  });

  it('sliding past the cancel threshold cancels on release', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    s = holdGestureReducer(s, { kind: 'move', dx: -(CANCEL_SLIDE_PX + 1) });
    expect(s.phase).toBe('cancelling');
    expect(holdOutcome(s, up(5_000))).toBe('cancel');
  });

  it('sliding back under the threshold un-cancels', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    s = holdGestureReducer(s, { kind: 'move', dx: -(CANCEL_SLIDE_PX + 1) });
    s = holdGestureReducer(s, { kind: 'move', dx: -10 });
    expect(s.phase).toBe('recording');
    expect(holdOutcome(s, up(5_000))).toBe('record');
  });

  it('holdTimer after release does nothing (stale timer)', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, up(100));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    expect(s.phase).toBe('idle');
  });

  it('reset returns to idle from any phase', () => {
    let s = holdGestureReducer(initialHoldState, down(0));
    s = holdGestureReducer(s, { kind: 'holdTimer' });
    s = holdGestureReducer(s, { kind: 'reset' });
    expect(s.phase).toBe('idle');
  });
});
```

- [ ] **Step 6: Run to fail, implement, run to pass**

Create `apps/web/src/lib/hold-gesture.ts`:

```ts
// Pure state machine for the hold-to-record gesture, kept out of React so the
// promote/cancel/hint logic is unit-testable. The component owns the actual timer and
// pointer capture; this decides what each event MEANS.
export const HOLD_THRESHOLD_MS = 300; // shorter press = a tap → show the "hold" hint
export const CANCEL_SLIDE_PX = 72;    // drag this far left while recording to cancel

export type HoldState = {
  phase: 'idle' | 'pressed' | 'recording' | 'cancelling';
  startedAt: number;
  dx: number;
};

export type HoldEvent =
  | { kind: 'down'; at: number }
  | { kind: 'move'; dx: number }
  | { kind: 'up'; at: number }
  | { kind: 'holdTimer' }
  | { kind: 'reset' };

export const initialHoldState: HoldState = { phase: 'idle', startedAt: 0, dx: 0 };

// What does an `up` (or other event) conclude? 'record' = stop and transcribe,
// 'cancel' = discard, 'hint' = too short, show hold-to-record hint. Null for non-final.
export function holdOutcome(state: HoldState, event: HoldEvent): 'record' | 'cancel' | 'hint' | null {
  if (event.kind !== 'up') return null;
  if (state.phase === 'pressed') return 'hint';
  if (state.phase === 'cancelling') return 'cancel';
  if (state.phase === 'recording') return 'record';
  return null;
}

export function holdGestureReducer(state: HoldState, event: HoldEvent): HoldState {
  switch (event.kind) {
    case 'down':
      return { phase: 'pressed', startedAt: event.at, dx: 0 };
    case 'holdTimer':
      return state.phase === 'pressed' ? { ...state, phase: 'recording' } : state;
    case 'move': {
      if (state.phase !== 'recording' && state.phase !== 'cancelling') return state;
      const phase = event.dx <= -CANCEL_SLIDE_PX ? 'cancelling' : 'recording';
      return { ...state, phase, dx: event.dx };
    }
    case 'up':
    case 'reset':
      return initialHoldState;
  }
}
```

Run: `pnpm --filter @carlog/web test src/lib/hold-gesture.test.ts` → 6 green.

- [ ] **Step 7: Gates + commit**

`pnpm turbo run build lint typecheck test` → green.

```bash
git add apps/web/src/lib/wav-encode.ts apps/web/src/lib/wav-encode.test.ts apps/web/src/lib/hold-gesture.ts apps/web/src/lib/hold-gesture.test.ts
git commit -m "feat(web): wav encoder and hold-gesture state machine"
```

---

### Task 2: Contract + transcribe route + provider

**Files:**
- Modify: `packages/contracts/src/chat.ts`, `packages/contracts/src/chat.test.ts`
- Create: `apps/api/src/transcribe-errors.ts`, `apps/api/src/transcribe-provider.ts`, `apps/api/src/in-memory-transcribe-provider.ts`, `apps/api/src/transcribe-route.ts`, `apps/api/src/transcribe-route.test.ts`
- Modify: `apps/api/src/errors.ts`, `apps/api/src/router.ts`, `apps/api/src/handler.ts`, `apps/api/package.json`
- Modify: `infrastructure/cdk/lib/carlog-stack.ts`

**Interfaces:**
- Produces (contracts): `TRANSCRIBE_AUDIO_MAX_B64 = 2_800_000`, `TranscribeRequestSchema = z.object({ audio: z.string().min(1).max(TRANSCRIBE_AUDIO_MAX_B64), language: z.enum(['uk-UA','en-US']) })`, `TranscribeResponseSchema = z.object({ text: z.string() })`, types via `z.infer`.
- Produces (api): `interface TranscribeProvider { transcribe(pcm: Buffer, language: 'uk-UA'|'en-US'): Promise<string> }`; `class TranscribeUnavailableError extends Error`; `handleTranscribeRoute(deps: { cars: CarRepository; transcriber: TranscribeProvider }, event: ApiEvent, ownerId: string, carId: string): Promise<ApiResult | null>` for `POST /cars/{carId}/chat/transcribe`; `RouteDeps` gains `transcriber: TranscribeProvider`.

- [ ] **Step 1: Contract test + schema** (TDD as in prior tasks — add to `chat.test.ts`: accepts a valid request; rejects empty audio, oversized audio (`'a'.repeat(TRANSCRIBE_AUDIO_MAX_B64 + 1)`), unknown language. Then add the schemas to `chat.ts` and run green.)

```ts
// chat.ts additions
export const TRANSCRIBE_AUDIO_MAX_B64 = 2_800_000; // ~60s of 16kHz mono 16-bit WAV, base64
export const TranscribeRequestSchema = z.object({
  audio: z.string().min(1).max(TRANSCRIBE_AUDIO_MAX_B64), // base64 WAV
  language: z.enum(['uk-UA', 'en-US']),
});
export const TranscribeResponseSchema = z.object({ text: z.string() });
export type TranscribeRequest = z.infer<typeof TranscribeRequestSchema>;
export type TranscribeResponse = z.infer<typeof TranscribeResponseSchema>;
```

- [ ] **Step 2: Failing route test**

Create `apps/api/src/transcribe-route.test.ts`:

```ts
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
```

- [ ] **Step 3: Implement errors, fake, provider, route**

`apps/api/src/transcribe-errors.ts`:

```ts
export class TranscribeUnavailableError extends Error {
  constructor(message = 'Transcription is temporarily unavailable') {
    super(message);
    this.name = 'TranscribeUnavailableError';
  }
}
```

`apps/api/src/in-memory-transcribe-provider.ts`:

```ts
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
```

`apps/api/src/transcribe-provider.ts`:

```ts
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
```

`apps/api/src/transcribe-route.ts`:

```ts
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

  const text = await deps.transcriber.transcribe(pcm, req.language);
  return ok(200, { text });
}
```

Wire-up:
- `errors.ts`: import `TranscribeUnavailableError`, add a branch mapping it to 503 (`{ error: 'TranscribeUnavailable', message }`), placed next to the `LlmUnavailableError` branch.
- `router.ts`: `RouteDeps` gains `transcriber: TranscribeProvider`; dispatch inside the existing `/cars/${id}/chat` block BEFORE `handleChatRoute` (exact-path match, no conflict):

```ts
    if (id && path === `/cars/${id}/chat/transcribe`) {
      const result = await handleTranscribeRoute({ cars: deps.cars, transcriber: deps.transcriber }, event, ownerId, id);
      if (result) return result;
    }
```

- `handler.ts`: `transcriber: new AwsTranscribeProvider()` in deps.
- `apps/api/package.json`: add `"@aws-sdk/client-transcribe-streaming": "^3.658.0"`, run `pnpm install`.
- Any router-test deps fixture gains `transcriber: new InMemoryTranscribeProvider('stub')` — check `router.test.ts`'s deps construction.

- [ ] **Step 4: CDK**

```ts
    httpApi.addRoutes({ path: '/cars/{id}/chat/transcribe', methods: [HttpMethod.POST], integration, authorizer });
```

IAM (next to the other `addToRolePolicy` calls; action name to be verified live in Task 4):

```ts
    // Transcribe streaming has no resource-level scoping.
    fn.addToRolePolicy(new PolicyStatement({ actions: ['transcribe:StartStreamTranscription'], resources: ['*'] }));
```

- [ ] **Step 5: Gates + synth + commit**

`pnpm turbo run build lint typecheck test` green; `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth > /dev/null && echo SYNTH_OK`.

```bash
git add packages/contracts/src/chat.ts packages/contracts/src/chat.test.ts apps/api/src/transcribe-errors.ts apps/api/src/transcribe-provider.ts apps/api/src/in-memory-transcribe-provider.ts apps/api/src/transcribe-route.ts apps/api/src/transcribe-route.test.ts apps/api/src/errors.ts apps/api/src/router.ts apps/api/src/handler.ts apps/api/package.json pnpm-lock.yaml infrastructure/cdk/lib/carlog-stack.ts
git commit -m "feat(api): voice transcription via Amazon Transcribe streaming"
```

---

### Task 3: Recorder hook + recording-bar composer UI

**Files:**
- Create: `apps/web/src/lib/useVoiceRecorder.ts`
- Create: `apps/web/src/components/chat/RecordingBar.tsx`
- Modify: `apps/web/src/components/chat/VoiceComposerButton.tsx`
- Modify: `apps/web/src/routes/ChatConversation.tsx`
- Modify: `apps/web/src/api-client.ts`
- Modify: `apps/web/src/i18n/locales/{en,uk}/chat.json`

**Interfaces:**
- Consumes: `encodeWav16kMono`, `MAX_CLIP_SECONDS`, `holdGestureReducer`/`holdOutcome`/constants (Task 1); `POST /cars/{id}/chat/transcribe` + `TranscribeRequest/Response` (Task 2).
- Produces: `useVoiceRecorder(): { supported: boolean; state: 'idle'|'recording'|'encoding'; level: number; seconds: number; start(): Promise<void>; stopAndEncode(): Promise<ArrayBuffer | null>; cancel(): void }`; `transcribeAudio(token, carId, wav: ArrayBuffer, language): Promise<string>` in api-client.

- [ ] **Step 1: i18n keys**

en `chat.json`: `"voiceHoldHint": "Hold to record"`, `"voiceSlideCancel": "Slide to cancel"`, `"voiceTranscribing": "Transcribing…"`, `"voiceRetry": "Didn't catch that — retry"`, `"voiceTooLong": "Recording is capped at 60 seconds"`.
uk `chat.json`: `"voiceHoldHint": "Утримуйте, щоб записати"`, `"voiceSlideCancel": "Проведіть, щоб скасувати"`, `"voiceTranscribing": "Розпізнаю…"`, `"voiceRetry": "Не розчув — спробуйте ще"`, `"voiceTooLong": "Запис обмежено 60 секундами"`.

- [ ] **Step 2: The recorder hook**

Create `apps/web/src/lib/useVoiceRecorder.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeWav16kMono, MAX_CLIP_SECONDS } from './wav-encode';

// Records mic audio in whatever container the browser prefers (webm/opus on Chrome,
// mp4/AAC on iOS Safari), exposes a live input level for the recording bar, and on stop
// decodes + re-encodes to 16kHz mono WAV (Transcribe streaming accepts pcm|ogg-opus|flac
// only). Auto-stops at MAX_CLIP_SECONDS (treated as a normal stop, not a cancel).
// Nothing is uploaded or persisted by this hook; the caller owns the bytes.
export function useVoiceRecorder() {
  const [supported] = useState(() =>
    typeof window !== 'undefined'
    && typeof MediaRecorder !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia));
  const [state, setState] = useState<'idle' | 'recording' | 'encoding'>('idle');
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const raf = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const stopResolve = useRef<((b: Blob | null) => void) | null>(null);

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    stream.current?.getTracks().forEach((t) => t.stop()); // mic indicator MUST go off
    stream.current = null;
    recorder.current = null;
    chunks.current = [];
    void audioCtx.current?.close();
    audioCtx.current = null;
    setLevel(0);
    setSeconds(0);
  }, []);

  const start = useCallback(async () => {
    if (!supported || state !== 'idle') return;
    const media = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.current = media;
    const rec = new MediaRecorder(media);
    recorder.current = rec;
    chunks.current = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType });
      stopResolve.current?.(blob.size > 0 ? blob : null);
      stopResolve.current = null;
    };
    rec.start();
    setState('recording');

    // Live level meter (RMS of the time-domain signal per animation frame).
    const ctx = new AudioContext();
    audioCtx.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(media).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) { const d = (data[i]! - 128) / 128; sum += d * d; }
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    let s = 0;
    timer.current = setInterval(() => {
      s += 1;
      setSeconds(s);
      if (s >= MAX_CLIP_SECONDS)

 recorder.current?.stop(); // resolves via onstop; caller's stopAndEncode picks it up
    }, 1000);
  }, [supported, state]);

  const stopAndEncode = useCallback(async (): Promise<ArrayBuffer | null> => {
    const rec = recorder.current;
    if (!rec || state !== 'recording') return null;
    setState('encoding');
    const blob = await new Promise<Blob | null>((resolve) => {
      stopResolve.current = resolve;
      if (rec.state !== 'inactive') rec.stop();
    });
    const ctxForDecode = new AudioContext();
    try {
      if (!blob) return null;
      const decoded = await ctxForDecode.decodeAudioData(await blob.arrayBuffer());
      const channels = Array.from({ length: decoded.numberOfChannels },
        (_, ch) => decoded.getChannelData(ch));
      return encodeWav16kMono({ channels, sampleRate: decoded.sampleRate });
    } catch {
      return null;
    } finally {
      void ctxForDecode.close();
      teardown();
      setState('idle');
    }
  }, [state, teardown]);

  const cancel = useCallback(() => {
    stopResolve.current = null;
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    teardown();
    setState('idle');
  }, [teardown]);

  useEffect(() => () => { // unmount: never leave the mic hot
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    teardown();
  }, [teardown]);

  return { supported, state, level, seconds, start, stopAndEncode, cancel };
}
```

- [ ] **Step 3: api-client**

```ts
export async function transcribeAudio(
  token: string, carId: string, wav: ArrayBuffer, language: 'uk-UA' | 'en-US',
): Promise<string> {
  const bytes = new Uint8Array(wav);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const res = await request(
    token, `/cars/${carId}/chat/transcribe`, TranscribeResponseSchema,
    { method: 'POST', body: JSON.stringify({ audio: btoa(bin), language }) },
  );
  return res.text;
}
```

(add `TranscribeResponseSchema` to the contracts import.)

- [ ] **Step 4: RecordingBar component**

Create `apps/web/src/components/chat/RecordingBar.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { tokens } from '../../theme/tokens';

type Props = {
  seconds: number;
  level: number;        // 0..1
  cancelling: boolean;  // slid past the cancel threshold
  transcribing: boolean;
};

const mmss = (total: number): string =>
  `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

// The composer row while recording: pulsing dot, timer, live level bars, and the
// slide-to-cancel label. Pure presentation — the gesture logic lives in the parent.
export function RecordingBar({ seconds, level, cancelling, transcribing }: Props) {
  const { t } = useTranslation(['chat']);
  const BARS = 24;

  if (transcribing) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexGrow: 1, px: 1, minHeight: 40 }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">{t('chat:voiceTranscribing')}</Typography>
      </Stack>
    );
  }

  return (
    <Stack direction="row" spacing={1.25} alignItems="center"
      sx={{ flexGrow: 1, px: 1, minHeight: 40, color: cancelling ? 'error.main' : 'text.primary' }}>
      <Box sx={{
        width: 10, height: 10, borderRadius: '50%', bgcolor: 'error.main', flexShrink: 0,
        animation: 'carlogRecPulse 1.2s ease-in-out infinite',
        '@keyframes carlogRecPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
      }} />
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 40 }}>
        {mmss(seconds)}
      </Typography>
      <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexGrow: 1, height: 24, overflow: 'hidden' }}
        aria-hidden>
        {Array.from({ length: BARS }, (_, i) => (
          <Box key={i} sx={{
            width: 3, borderRadius: 1, bgcolor: 'currentColor', opacity: 0.7,
            height: `${Math.max(12, Math.min(100, level * 100 * (0.6 + 0.4 * Math.sin(i))))}%`,
            transition: `height ${tokens.motion.duration.fast}ms ${tokens.motion.easing.standard}`,
          }} />
        ))}
      </Stack>
      <Typography variant="caption" color={cancelling ? 'error.main' : 'text.secondary'} sx={{ flexShrink: 0 }}>
        ‹ {t('chat:voiceSlideCancel')}
      </Typography>
    </Stack>
  );
}
```

- [ ] **Step 5: Wire the composer**

Rework `VoiceComposerButton.tsx` + `ChatConversation.tsx`:

- The mic button becomes a **pointer-event gesture target**: `onPointerDown` → dispatch `down`, `setPointerCapture`, start a `HOLD_THRESHOLD_MS` timeout dispatching `holdTimer` (which triggers `recorder.start()`); `onPointerMove` → dispatch `move` with `dx = e.clientX - downX`; `onPointerUp` → compute `holdOutcome`, dispatch `up`, clear the timeout.
  - outcome `hint` → show `voiceHoldHint` in the existing Alert slot (auto-dismiss ~2s).
  - outcome `cancel` → `recorder.cancel()`.
  - outcome `record` → `const wav = await recorder.stopAndEncode()`; if null → `voiceRetry` alert; else `transcribing` state → `transcribeAudio(token, carId, wav, lang)` → append to input (`setInput((v) => v ? \`${v} ${text}\` : text)`), focus the field. On failure/empty text: keep `wav` in a ref and show `voiceRetry` with a Retry button that re-posts the same buffer; a second failure discards the ref.
- While `recorder.state !== 'idle'` or transcribing, the composer's TextField+attach are replaced by `<RecordingBar seconds level cancelling transcribing />` (the row swap, Telegram-style). `cancelling` comes from the gesture state.
- The 60s auto-stop path: when `seconds` hits the cap while still holding, treat as outcome `record` (the hook already stopped the recorder; call `stopAndEncode` which resolves with the already-collected blob) and show `voiceTooLong` as an info alert alongside the transcription flow.
- **Fallback:** when `!recorder.supported && speech.supported`, keep today's tap-to-toggle Web Speech behavior (existing `useSpeechRecognition` + listening UI). When neither → no mic. The `readOnly`-while-listening TextField prop stays ONLY for the fallback path.
- `lang` from `i18n.language.startsWith('uk') ? 'uk-UA' : 'en-US'` (same pattern as today).
- Get `token`/`carId` the way `usePostChatMessage` consumers do — check `ChatConversation`'s existing wiring; add a small `useTranscribe(carId)` mutation in `queries.ts` if that matches house style better than calling `transcribeAudio` directly (implementer's judgment; mutation preferred for `isPending`).

- [ ] **Step 6: Gates + commit**

`pnpm turbo run build lint typecheck test` → green.

```bash
git add apps/web/src/lib/useVoiceRecorder.ts apps/web/src/components/chat/RecordingBar.tsx apps/web/src/components/chat/VoiceComposerButton.tsx apps/web/src/routes/ChatConversation.tsx apps/web/src/api-client.ts apps/web/src/queries.ts apps/web/src/i18n/locales/en/chat.json apps/web/src/i18n/locales/uk/chat.json
git commit -m "feat(web): hold-to-record voice input with server transcription"
```

---

### Task 4: Merge, deploy, IAM verification

- [ ] **Step 1: Gates** — `pnpm turbo run build lint typecheck test` → 18/18.

- [ ] **Step 2: Docs** — `carlog-docs/API.md`: add `POST /cars/{id}/chat/transcribe   # voice clip (16kHz WAV) → text via Amazon Transcribe` under the AI Chat section. Commit `docs: transcribe route`.

- [ ] **Step 3: Merge + deploy backend + web**

```bash
git checkout main && git merge --no-ff feat/voice-v2-transcribe -m "feat: voice input v2 — hold-to-record + Amazon Transcribe"
AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never
AWS_PROFILE=yevhenii ./scripts/deploy-web.sh
```

- [ ] **Step 4: IAM live probe (the action-name uncertainty)**

The IAM action for Transcribe streaming is `transcribe:StartStreamTranscription` per AWS docs, but verify empirically: call the live route with a tiny valid WAV and a real JWT is NOT mintable (hard rule) — so instead invoke the Lambda's code path via CloudWatch: send an unauthenticated request (expect 401 — route exists), then check that a real in-app dictation (user's phone) succeeds. If CloudWatch shows `AccessDeniedException` from Transcribe, the action name needs adjusting (`transcribestreaming:StartStreamTranscription`) — fix, redeploy, re-verify.

- [ ] **Step 5: User acceptance** — Ukrainian dictation on iPhone Safari PWA: hold mic, speak «замінив оливу і фільтри на двісті шістдесят тисяч», release, verify the text quality beats the old Web Speech, edit, send. Slide-to-cancel discards. 60s cap message appears on a long hold.

---

## Notes for the implementer

- The WAV encoder takes `{ channels, sampleRate }` instead of `AudioBuffer` precisely so it's testable in jsdom — do not "simplify" to AudioBuffer.
- `stopAndEncode` uses a SECOND AudioContext for decode: iOS suspends contexts created outside a user gesture; decode-only contexts are fine, but close them.
- The gesture reducer is pure; the component owns timers/pointer capture. Don't merge them.
- Audio must never touch S3/Dynamo — request body only, discarded after the provider call.
