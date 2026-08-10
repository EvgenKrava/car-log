import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeWav16kMono, MAX_CLIP_SECONDS } from './wav-encode';
import { createPcmBuffer, type PcmBuffer } from './pcm-buffer';
import pcmWorkletUrl from './pcm-capture-worklet.js?url';

// Records mic audio, exposes a live input level for the recording bar, and on stop produces
// a 16kHz mono WAV (Transcribe streaming accepts pcm|ogg-opus|flac only). Auto-stops at
// MAX_CLIP_SECONDS (treated as a normal stop, not a cancel). Nothing is uploaded or
// persisted by this hook; the caller owns the bytes.
//
// TWO CAPTURE PATHS, chosen in acquire():
//
//   'pcm'      — preferred. An AudioWorkletNode taps the mic on the audio thread and posts
//                raw Float32 samples up; stop just concatenates them and encodes. No
//                container is ever created, so nothing has to be decoded.
//   'recorder' — fallback for browsers without AudioWorklet: MediaRecorder into whatever
//                container it prefers, then decodeAudioData + re-encode.
//
// The 'pcm' path exists because the 'recorder' path CANNOT WORK ON iOS. WebKit's
// MediaRecorder writes fragmented MP4 (`MediaRecorderPrivateWriterAVFObjC` sets
// AVFileTypeProfileMPEG4CMAFCompliant / ...AppleHLS and emits segments), and WebKit's own
// `decodeAudioData` cannot parse fragmented MP4 — webkit.org/b/160940, "decodeAudioData is
// not able to decode mp4a fragmented (non-fragmented files work fine)", open since 2016 and
// still unfixed. MDN says as much about the API contract: decodeAudioData "only works on
// complete file data, not fragments". The AAC decoder is fine; the container parser is the
// failure point. Symptom: recording appeared to work, then every clip failed to encode, so
// nothing was ever posted to /transcribe and the user only saw "didn't catch that".
//
// Starting is deliberately SPLIT IN TWO, and the split is load-bearing on iOS:
//
//   acquire()        — MUST be called synchronously from the pointerdown handler.
//                     Fires getUserMedia, constructs + resumes the AudioContext, and kicks
//                     off the worklet module fetch.
//   beginRecording() — called when the hold gesture promotes (300ms later, from a
//                     setTimeout). Connects the worklet (or starts the MediaRecorder).
//
// iOS/Safari gate both `getUserMedia` and AudioContext startup on a real user-gesture
// ("transient activation") context. A setTimeout callback is NOT one: called from there,
// getUserMedia rejects (or silently never prompts) and a fresh AudioContext stays
// `suspended` forever, so no samples are ever rendered and the level meter reads pure
// silence. Recording semantics still begin at promote-time — acquire() leaves `state` at
// 'idle' so a short tap never flashes the recording UI — but the privileged calls happen in
// the gesture where iOS allows them. Whoever calls acquire() owns releasing it: any gesture
// that ends WITHOUT recording (short tap, slide-to-cancel, pointercancel) must call
// cancel(), or the mic stays hot.
type PcmCapture = {
  buffer: PcmBuffer;
  node: AudioWorkletNode;
  source: MediaStreamAudioSourceNode;
  sink: GainNode;
  // Captured at connect time so stopAndEncode() can read it without touching a context
  // teardown() may already be closing. iOS reports whatever the hardware gives (48000
  // commonly, other rates during an active audio session); the encoder resamples from any
  // input rate, so the real value is simply passed through.
  sampleRate: number;
};

export function useVoiceRecorder() {
  // True only if at least one of the two capture paths can actually run, so the caller never
  // renders a mic button that is guaranteed to produce nothing. AudioWorkletNode is the
  // reliable feature proxy for the 'pcm' path (AudioContext alone is not — it predates
  // AudioWorklet by years); MediaRecorder is the 'recorder' path's.
  const [supported] = useState(() =>
    typeof window !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && ((typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined')
      || typeof MediaRecorder !== 'undefined'));
  const [state, setState] = useState<'idle' | 'recording' | 'encoding'>('idle');
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  // Mirrors useSpeechRecognition's error shape so the caller can render the same
  // denied/failed copy regardless of which voice path is active. 'denied' = the browser's
  // permission prompt was refused (or blocked by a prior denial); 'failed' = any other
  // getUserMedia rejection (no device, already in use, insecure context, etc).
  const [error, setError] = useState<'denied' | 'failed' | null>(null);

  const pcm = useRef<PcmCapture | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const raf = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const stopResolve = useRef<((b: Blob | null) => void) | null>(null);
  // The MAX_CLIP_SECONDS timer calls rec.stop() on its own, without anyone awaiting the
  // result yet (the caller hasn't invoked stopAndEncode() at that point). `onstop` fires
  // asynchronously and would otherwise resolve into a stopResolve that is still null,
  // losing the blob — a later stopAndEncode() would then see state === 'inactive', skip
  // calling stop() again, and await a promise nothing will ever resolve. Cache it here so
  // stopAndEncode() can pick it up whichever order the two land in. `undefined` = nothing
  // cached; `null` = cached, and it was an empty recording. ('recorder' path only: the 'pcm'
  // path has no async stop — its samples just sit in the buffer until stop reads them.)
  const cappedBlob = useRef<Blob | null | undefined>(undefined);
  // start()/stopAndEncode()/cancel() are called from event handlers, not render, so they
  // read this instead of the `state` closure to avoid stale-closure bugs across re-renders.
  const stateRef = useRef<'idle' | 'recording' | 'encoding'>('idle');
  const setPhase = (s: 'idle' | 'recording' | 'encoding') => { stateRef.current = s; setState(s); };

  // getUserMedia's permission prompt can outlive the gesture that requested it (mainly the
  // very first grant on a device). If the gesture concludes (cancel, or an immediate
  // stop-and-encode) before that prompt resolves, the acquisition must not go on to open
  // the mic with nobody left to tear it down. `runId` is bumped by cancel() to invalidate
  // an in-flight acquire(); `startInFlight` lets stopAndEncode() wait for acquisition +
  // capture setup to finish before trying to stop it.
  const runId = useRef(0);
  const startInFlight = useRef<Promise<void> | null>(null);
  // The in-flight getUserMedia from acquire(). Resolves to the live stream, or null if it
  // was denied/failed/invalidated. beginRecording() awaits this rather than re-requesting.
  const acquiring = useRef<Promise<MediaStream | null> | null>(null);
  // The worklet module fetch, started in acquire() so it overlaps the permission prompt
  // instead of adding latency after the hold promotes. Resolves false if the module can't
  // be installed, which drops this gesture to the 'recorder' path.
  const workletReady = useRef<Promise<boolean> | null>(null);

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    // Single choke point for the capture graph too: dropping the port handler here is what
    // stops a late worklet message (one quantum can already be in flight) from writing
    // `level` back up after this reset it to 0.
    if (pcm.current) {
      pcm.current.node.port.onmessage = null;
      try {
        pcm.current.source.disconnect();
        pcm.current.node.disconnect();
        pcm.current.sink.disconnect();
      } catch { /* already disconnected with the context */ }
      pcm.current = null;
    }
    stream.current?.getTracks().forEach((t) => t.stop()); // mic indicator MUST go off
    stream.current = null;
    recorder.current = null;
    chunks.current = [];
    cappedBlob.current = undefined;
    acquiring.current = null;
    workletReady.current = null;
    void audioCtx.current?.close();
    audioCtx.current = null;
    setLevel(0);
    setSeconds(0);
  }, []);

  // Call this SYNCHRONOUSLY from the pointerdown handler — see the header comment. Cheap
  // and idempotent: a second pointer landing mid-gesture re-uses the first acquisition.
  const acquire = useCallback((): void => {
    if (!supported || stateRef.current !== 'idle' || acquiring.current) return;
    const myRun = ++runId.current;
    setError(null);

    // Created here, inside the gesture, purely so iOS lets it leave 'suspended' — a
    // suspended context renders nothing, which on the 'pcm' path means zero samples, not
    // just a flat meter. If construction fails there is no context to capture on, and
    // beginRecording() falls back to MediaRecorder.
    try {
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      if (ctx.state === 'suspended') void ctx.resume();
      // Path choice happens here: worklet if this browser has one, MediaRecorder if not.
      // The .catch keeps a rejection from a context teardown() closed mid-fetch from
      // surfacing as an unhandled rejection.
      workletReady.current = typeof ctx.audioWorklet?.addModule === 'function'
        ? ctx.audioWorklet.addModule(pcmWorkletUrl).then(() => true, () => false)
        : Promise.resolve(false);
    } catch {
      audioCtx.current = null;
      workletReady.current = Promise.resolve(false);
    }

    // The async IIFE runs synchronously up to its first await, so the getUserMedia CALL
    // itself still happens inside the gesture — only the permission prompt resolves later.
    const p = (async (): Promise<MediaStream | null> => {
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        // Surface denied vs. any other failure (no device, already in use, insecure
        // context, etc) so the caller can show the right copy — previously this was
        // swallowed silently and the mic-denied path showed nothing at all.
        const name = (err as { name?: string }).name;
        setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed');
        return null;
      }
      if (myRun !== runId.current) {
        // The gesture ended (cancel()) while the permission prompt was pending — never
        // let this stream go live with nothing left to stop it.
        media.getTracks().forEach((t) => t.stop());
        return null;
      }
      stream.current = media;
      return media;
    })();

    acquiring.current = p;
    const settled = p.then(() => undefined);
    startInFlight.current = settled;
    void settled.finally(() => { if (startInFlight.current === settled) startInFlight.current = null; });
  }, [supported]);

  // `seconds` for the recording bar, plus the MAX_CLIP_SECONDS auto-stop. Shared by both
  // paths; `onCap` is what each has to do when the cap lands ('pcm': nothing — its sample
  // budget already refuses anything past the cap).
  const startTimer = useCallback((onCap: () => void) => {
    let s = 0;
    timer.current = setInterval(() => {
      s += 1;
      setSeconds(s);
      if (s >= MAX_CLIP_SECONDS) {
        onCap();
        // Stop ticking: without this the interval outlives the recording (the user may
        // still be holding) and `seconds` climbs past the cap forever.
        if (timer.current) { clearInterval(timer.current); timer.current = null; }
      }
    }, 1000);
  }, []);

  // `setLevel` (a React state write) is throttled to ~10/s: un-throttled, it re-rendered
  // the whole (un-memoized) markdown chat list on every update for up to 60s, causing
  // visible stutter on the primary device. Only commit when the value actually moved
  // (>0.02) or 100ms elapsed, whichever first — responsive to real level changes while
  // skipping the vast majority of same-ish updates. Matters more on the 'pcm' path, where
  // samples arrive ~375x/s (one per 128-frame render quantum) rather than once per frame.
  const makeLevelCommit = useCallback(() => {
    let lastCommitted = 0;
    let lastCommitAt = 0;
    return (next: number) => {
      const now = performance.now();
      if (Math.abs(next - lastCommitted) > 0.02 || now - lastCommitAt >= 100) {
        lastCommitted = next;
        lastCommitAt = now;
        setLevel(next);
      }
    };
  }, []);

  // Preferred path: tap raw PCM off the audio thread. Throws if the graph can't be built,
  // which drops this gesture to startRecorder().
  const startPcm = useCallback((media: MediaStream, ctx: AudioContext) => {
    const node = new AudioWorkletNode(ctx, 'pcm-capture');
    const source = ctx.createMediaStreamSource(media);
    const sink = ctx.createGain();
    const buffer = createPcmBuffer(Math.ceil(MAX_CLIP_SECONDS * ctx.sampleRate));
    // Published to the ref BEFORE anything is connected: teardown() can only disconnect a
    // graph it can see, so if any wiring step below throws, this is what keeps the
    // half-built chain reachable instead of stranded until the context closes.
    pcm.current = { buffer, node, source, sink, sampleRate: ctx.sampleRate };

    // A node is only guaranteed to be pulled while it reaches the destination, so route it
    // there through a silent gain — without the gain the mic would be echoed out of the
    // speaker (and straight back into itself).
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);

    const commitLevel = makeLevelCommit();
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const samples = e.data;
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i]! * samples[i]!;
      // Meter first, unconditionally: it must keep moving even for the final partial quantum
      // the budget truncates, otherwise the bar freezes just before the cap lands.
      commitLevel(Math.min(1, Math.sqrt(sum / samples.length) * 3));
      buffer.append(samples); // past the 60s budget this keeps the samples, drops the rest
    };
    // acquire() already resumed inside the gesture; re-assert only if something (an
    // interruption, an iOS audio-session change) put it back to sleep, because a suspended
    // context renders no quanta at all and would hand back an empty clip.
    if (ctx.state !== 'running') void ctx.resume();
    // The buffer's budget is what actually bounds the clip, but stop capturing at the cap
    // too: without this the mic stays open and the worklet keeps posting ~375 msg/s for as
    // long as the finger is down, all of it discarded. The caller normally reacts to
    // `seconds` and finishes the clip — this is the hook's own backstop if it doesn't.
    startTimer(() => {
      const cap = pcm.current;
      if (!cap) return;
      cap.node.port.onmessage = null;
      stream.current?.getTracks().forEach((t) => t.stop()); // mic indicator off at 60s
    });
  }, [makeLevelCommit, startTimer]);

  // Fallback path for browsers without AudioWorklet. Do not use this on iOS — see the
  // fragmented-MP4 note in the header for why its clips cannot be decoded there.
  const startRecorder = useCallback((media: MediaStream, ctx: AudioContext | null) => {
    const rec = new MediaRecorder(media);
    recorder.current = rec;
    chunks.current = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType });
      const result = blob.size > 0 ? blob : null;
      if (stopResolve.current) { stopResolve.current(result); stopResolve.current = null; }
      else cappedBlob.current = result; // auto-stopped before stopAndEncode() was called
    };
    rec.start();

    // Level meter from an analyser (RMS of the time-domain signal per animation frame),
    // since this path has no sample stream of its own to measure.
    if (ctx) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(media).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const commitLevel = makeLevelCommit();
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) { const d = (data[i]! - 128) / 128; sum += d * d; }
        commitLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    }

    // onstop caches the blob; stopAndEncode() picks it up whenever it's called.
    startTimer(() => recorder.current?.stop());
  }, [makeLevelCommit, startTimer]);

  // Promote an acquired mic to an actual recording. Safe to call from a setTimeout: nothing
  // in here needs a user gesture (AudioWorklet/MediaRecorder do not; getUserMedia and
  // AudioContext startup do, and already happened in acquire()).
  const beginRecording = useCallback((): Promise<void> => {
    const pending = acquiring.current;
    if (!pending || stateRef.current !== 'idle') return Promise.resolve();
    const myRun = runId.current;
    const p = (async () => {
      const media = await pending;
      const hasWorklet = (await workletReady.current) ?? false;
      // Denied/failed, or the gesture was cancelled while the prompt was pending — in the
      // latter case acquire() already stopped the tracks. Re-checked after BOTH awaits.
      if (!media || myRun !== runId.current || stateRef.current !== 'idle') return;
      const ctx = audioCtx.current; // created + resumed inside the gesture by acquire()
      try {
        if (hasWorklet && ctx) startPcm(media, ctx);
        else startRecorder(media, ctx);
        setPhase('recording');
      } catch (err) {
        // Graph/recorder construction failed (worklet name not registered, unsupported
        // codec, …). getUserMedia already granted a live stream at this point — without
        // this catch it would stay open forever with nothing around to stop() it. Try the
        // other path once before giving up, so a worklet failure isn't fatal to voice.
        console.error('voice capture failed', (err as Error).name, (err as Error).message);
        try {
          if (hasWorklet && ctx && typeof MediaRecorder !== 'undefined') {
            // Drop the half-built PCM graph first: leaving pcm.current set would make
            // stopAndEncode take the PCM branch and encode its empty buffer, never stopping
            // the MediaRecorder this fallback is about to start.
            if (pcm.current) {
              pcm.current.node.port.onmessage = null;
              pcm.current = null;
            }
            startRecorder(media, ctx);
            setPhase('recording');
            return;
          }
        } catch { /* fall through to teardown */ }
        // Both paths are gone, so this gesture can never produce a clip. Surface it as
        // 'failed' (the caller already renders that as the generic voice-retry notice)
        // rather than tearing down silently and leaving the user tapping a dead button.
        setError('failed');
        // If a MediaRecorder was started before the throw, teardown() below stops the tracks,
        // which makes it auto-fire `stop`. Drop the handler first: it would otherwise write
        // this dead clip into cappedBlob AFTER teardown reset it, where the next recording's
        // stopAndEncode would pick it up instead of its own audio (same reason cancel() does).
        if (recorder.current) recorder.current.onstop = null;
        teardown();
        setPhase('idle');
      }
    })();
    startInFlight.current = p;
    void p.finally(() => { if (startInFlight.current === p) startInFlight.current = null; });
    return p;
  }, [startPcm, startRecorder, teardown]);

  const stopAndEncode = useCallback(async (): Promise<ArrayBuffer | null> => {
    // Let a pending permission prompt / capture setup settle first. Two links in the chain
    // can be in flight (acquire → beginRecording), and awaiting the first can install the
    // second, so drain until it's actually empty rather than awaiting once.
    for (let i = 0; startInFlight.current && i < 4; i += 1) await startInFlight.current;
    const capture = pcm.current;
    const rec = recorder.current;
    if ((!capture && !rec) || stateRef.current !== 'recording') {
      // Nothing was recording (denied mic, or released before capture came up), but
      // acquire() may still hold a live stream — never leave it hot for the caller.
      if (stateRef.current === 'idle') { runId.current += 1; teardown(); }
      return null;
    }
    setPhase('encoding');

    // 'pcm': the samples are already here, uncontained and undecoded. Detach the tap and
    // encode straight from the accumulated buffer — no Blob, no decodeAudioData, nothing
    // that can trip over a container WebKit won't parse.
    if (capture) {
      try {
        capture.node.port.onmessage = null;
        const mono = capture.buffer.concat();
        if (mono.length === 0) {
          // Should be unreachable; if it ever happens, this line is the whole diagnosis
          // (a suspended context renders no quanta, so the meter and this both read empty).
          console.error('voice encode failed: no samples captured', audioCtx.current?.state ?? 'no-context');
          return null;
        }
        return encodeWav16kMono({ channels: [mono], sampleRate: capture.sampleRate });
      } catch (err) {
        // Never swallow the reason silently again — the previous bare `catch {}` here is
        // what made the fragmented-MP4 failure invisible for as long as it was.
        console.error('voice encode failed', (err as Error).name, (err as Error).message);
        return null;
      } finally {
        teardown();
        setPhase('idle');
      }
    }

    const blob = cappedBlob.current !== undefined
      ? cappedBlob.current // the MAX_CLIP_SECONDS timer already stopped + resolved this
      : await new Promise<Blob | null>((resolve) => {
        stopResolve.current = resolve;
        if (rec && rec.state !== 'inactive') rec.stop();
      });
    // Decode on the context acquire() already built inside the user gesture where iOS
    // permits it. iOS also caps how many AudioContexts a page may hold, so reusing the live
    // one (rather than opening a second per clip) keeps long sessions from hitting that
    // ceiling. decodeAudioData does not require a running context, so a suspended one is
    // fine. Fall back to a fresh context only if acquire()'s construction failed.
    const ownCtx = audioCtx.current === null;
    const ctxForDecode = audioCtx.current ?? new AudioContext();
    let decodeTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!blob) return null;
      // A real Safari/AAC decode failure mode is HANGING rather than rejecting — with a
      // bare await, that leaves ctxForDecode (and its audio resources) open forever,
      // since the `finally` below never runs until the await settles. Race it against a
      // 10s timeout instead; either way we fall through to the same `finally` cleanup and
      // the caller sees the existing null → retry path.
      const decode = ctxForDecode.decodeAudioData(await blob.arrayBuffer());
      const timeout = new Promise<never>((_, reject) => {
        decodeTimeout = setTimeout(() => reject(new Error('decode timed out')), 10_000);
      });
      const decoded = await Promise.race([decode, timeout]);
      const channels = Array.from({ length: decoded.numberOfChannels },
        (_, ch) => decoded.getChannelData(ch));
      return encodeWav16kMono({ channels, sampleRate: decoded.sampleRate });
    } catch (err) {
      // See the note above: silence here is what hid the iOS bug. On iOS this is the
      // fragmented-MP4 EncodingError — which is why this path is now the fallback.
      console.error('voice encode failed', (err as Error).name, (err as Error).message);
      return null;
    } finally {
      if (decodeTimeout) clearTimeout(decodeTimeout);
      // Only close a context we opened ourselves; the shared one is teardown()'s to close.
      if (ownCtx) void ctxForDecode.close();
      teardown();
      setPhase('idle');
    }
  }, [teardown]);

  const cancel = useCallback(() => {
    runId.current += 1; // invalidate an acquire() whose getUserMedia prompt hasn't resolved yet
    stopResolve.current = null;
    const rec = recorder.current;
    if (rec) {
      // `stop()` resolves `onstop` asynchronously, arriving after teardown() below has
      // already run. With stopResolve nulled, that late event would otherwise fall into
      // the "cache it for later" branch and leak this cancelled clip's audio into
      // cappedBlob — where the *next* recording's stopAndEncode() would wrongly pick it
      // up instead of stopping and encoding what was actually just recorded.
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
    }
    // The 'pcm' path needs no equivalent: teardown() drops the port handler and the whole
    // buffer with it, so a cancelled clip's samples cannot reach the next recording.
    teardown();
    setPhase('idle');
  }, [teardown]);

  useEffect(() => () => { // unmount: never leave the mic hot
    runId.current += 1; // invalidate an acquire() whose getUserMedia prompt hasn't resolved yet
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    teardown();
  }, [teardown]);

  return { supported, state, level, seconds, error, acquire, beginRecording, stopAndEncode, cancel };
}
