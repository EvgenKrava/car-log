# Voice Input v2 — Hold-to-Record + Amazon Transcribe

**Date:** 2026-08-07
**Status:** Approved

## Goal

Replace the chat composer's Web Speech dictation (poor Ukrainian quality on iOS, weak UI)
with a Telegram-style **hold-to-record** flow backed by **Amazon Transcribe streaming**:
hold mic → recording bar (timer, live level, slide-to-cancel) → release → ~2–4s
transcription → text lands in the input **for review, never auto-sent**.

## Decisions taken (confirmed 2026-08-07)

- Hold-to-record UX (not tap-to-toggle, not send-as-voice-message).
- Engine: **Amazon Transcribe streaming** (all-AWS, `uk-UA` supported, $0.024/min,
  60 free min/mo in year one; user confirmed cost acceptable).
- Web Speech remains only as a hidden fallback when recording is unsupported.

## Hard technical facts (verified against AWS API reference)

- **Transcribe *streaming* accepts `pcm | ogg-opus | flac` ONLY.** Chrome MediaRecorder
  emits webm/opus (not accepted by streaming); **iOS Safari emits mp4/AAC (accepted by
  neither streaming nor comfortable batch)**. The primary device is an iPhone, so format
  conversion is a core requirement, not an edge case.
- **Resolution: client-side re-encode to 16kHz mono PCM WAV.** `AudioContext.decodeAudioData`
  decodes whatever the browser recorded; downsample + WAV header is dependency-free
  (~50 lines). 60s at 16kHz mono 16-bit ≈ 1.9MB (~2.6MB base64) — fits API Gateway's 10MB
  body limit, so **no S3 round-trip**: the audio goes in the POST body and is never stored.

## Architecture

```
hold mic ──▶ MediaRecorder (native format) + AnalyserNode (live level)
release ──▶ decodeAudioData ──▶ downsample 16kHz mono ──▶ WAV bytes ──▶ base64
        ──▶ POST /cars/{id}/chat/transcribe { audio, language }
                └─▶ Lambda: chunk PCM ──▶ StartStreamTranscription (uk-UA/en-US)
                └─◀ { text }  (~2–4s for a 15s clip)
text ──▶ chat input field (editable; user sends manually)
```

## Web

### `useVoiceRecorder` hook (`apps/web/src/lib/useVoiceRecorder.ts`)

- `getUserMedia({ audio: true })` + `MediaRecorder` in the browser's preferred format.
- Exposes `{ supported, state: 'idle'|'recording'|'encoding', level: number, seconds,
  start(), stopAndEncode(): Promise<Blob /* wav */>, cancel() }`.
- Live `level` (0..1) from an `AnalyserNode` (RMS per animation frame) — drives a real
  level meter, not a decorative animation.
- Hard cap **60s**: auto-stops at the cap (behaves as release, not cancel).
- Releases the media stream tracks on stop/cancel/unmount — the mic indicator must never
  stay on.

### WAV encoder (`apps/web/src/lib/wav-encode.ts`)

Pure: `encodeWav16kMono(audio: AudioBuffer): ArrayBuffer` — average channels to mono,
linear-resample to 16 000 Hz, 16-bit little-endian PCM, standard 44-byte RIFF header.
Unit-tested against a synthetic sine `AudioBuffer` (header fields, byte length,
downsample ratio, amplitude preservation).

### Composer UX (`VoiceComposerButton` replaced by a recording-aware composer strip)

- Idle: mic in the right slot (as today; swaps to Send when there's content).
- **Hold ≥300ms** starts recording (a shorter press is treated as a tap and shows a brief
  "hold to record" hint). Pointer events, not click.
- While holding, the composer row transforms: pulsing red dot, `m:ss` timer
  (`aria-live` OFF; a one-time hidden "recording" status instead, per the app's
  a11y convention), live level bars, and a **slide-left-to-cancel** affordance
  (drag ≥72px left cancels — bar tints and label changes while past the threshold).
- Release → `encoding` then transcribing state: the bar shows a spinner + "transcribing…";
  the mic slot is disabled meanwhile.
- Result text is **appended** to the input field (preserving anything typed), field
  focused, normal Send flow. Never auto-send.
- Errors: mic denied → existing `voiceDenied` copy; transcription failed/empty → keep the
  encoded WAV in memory and show "didn't catch that — retry" with a retry button that
  re-posts the same audio (no re-recording); a second failure discards.
- Unsupported (`!MediaRecorder || !getUserMedia`): fall back to the existing Web Speech
  hook behind the same mic button (tap-to-toggle as today); if that's also unsupported,
  no mic. `useSpeechRecognition` is kept for this path only; the live-typing/readOnly
  TextField behavior is removed.

## Backend

### Route: `POST /cars/{id}/chat/transcribe`

- Contract (`packages/contracts/src/chat.ts`):
  `TranscribeRequestSchema = { audio: z.string().max(2_800_000) /* base64 WAV */,
  language: z.enum(['uk-UA', 'en-US']) }`, response `{ text: z.string() }`.
- Route validates ownership (`cars.getById` — same guard as every chat route), decodes
  base64, sanity-checks the RIFF header + PCM format + ≤60s duration (reject 400
  otherwise — the payload cap alone doesn't bound duration if someone sends 8kHz).
- `TranscribeProvider` port in the api layer (NOT domain — this is pure infrastructure):
  `interface TranscribeProvider { transcribe(pcm: Buffer, language: string): Promise<string> }`
  with an `AwsTranscribeProvider` impl using `@aws-sdk/client-transcribe-streaming`
  (`StartStreamTranscriptionCommand`, `MediaEncoding: 'pcm'`,
  `MediaSampleRateHertz: 16000`, chunked async iterable of ~8KB frames, concatenate
  final — non-partial — alternatives' transcripts).
  In-memory fake for tests.
- Timeouts: a 60s clip transcribes well under the 30s API GW cap (streaming keeps pace
  with faster-than-realtime feed); still, cap the provider call at 25s and map a timeout
  to the same error as a Transcribe failure (503 `LlmUnavailableError`-style — add a
  dedicated `TranscribeUnavailableError` mapped to 503).
- New dependency: `@aws-sdk/client-transcribe-streaming` in `apps/api` only.

### CDK

- IAM: `transcribestreaming:StartStreamTranscription` (resource `*` — the action is not
  resource-scopable) — verify exact action string against the SDK during implementation;
  it is `transcribe:StartStreamTranscription` in some policy contexts. The implementer
  must confirm the working action name empirically (deploy + live call) rather than
  trusting docs.
- One route: `POST /cars/{id}/chat/transcribe`, JWT authorizer.

## i18n

`chat` namespace, en+uk: `voiceHoldHint` ("Hold to record" / "Утримуйте, щоб записати"),
`voiceSlideCancel` ("Slide to cancel" / "Проведіть, щоб скасувати"), `voiceTranscribing`
("Transcribing…" / "Розпізнаю…"), `voiceRetry` ("Didn't catch that — retry" /
"Не розчув — спробуйте ще"), `voiceTooLong` ("Recording is capped at 60 seconds" /
"Запис обмежено 60 секундами"). Existing keys (`voiceStart`, `voiceStop`, `voiceDenied`,
`voiceListening`) stay for the fallback path.

## Cost guardrails

60s per-clip cap (contract + client). No per-user quotas in v1 — usage is personal;
Transcribe at this volume is pennies/month and free-tier-covered in year one.

## Testing

- `wav-encode` unit tests (synthetic AudioBuffer; header bytes, length math, downsampling).
- Hold-gesture state machine (extract as a pure reducer if practical) unit tests:
  short-press → hint; hold → record; slide past threshold → cancel; release → encode.
- Route tests with the fake provider: happy path, empty transcript, provider failure →
  503, bad RIFF/oversized → 400, ownership (foreign car → 404).
- Live acceptance (user): Ukrainian dictation on iPhone Safari PWA — the whole point.

## Out of scope

- Storing audio (nothing persists; the clip lives in memory only).
- Send-as-voice-message (audio attachments in chat).
- Custom vocabulary / hints for car-domain terms (possible follow-up if quality needs it).
- Applying voice to other inputs (event forms) — chat composer only.
