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
  // The MAX_CLIP_SECONDS timer calls rec.stop() on its own, without anyone awaiting the
  // result yet (the caller hasn't invoked stopAndEncode() at that point). `onstop` fires
  // asynchronously and would otherwise resolve into a stopResolve that is still null,
  // losing the blob — a later stopAndEncode() would then see state === 'inactive', skip
  // calling stop() again, and await a promise nothing will ever resolve. Cache it here so
  // stopAndEncode() can pick it up whichever order the two land in. `undefined` = nothing
  // cached; `null` = cached, and it was an empty recording.
  const cappedBlob = useRef<Blob | null | undefined>(undefined);
  // start()/stopAndEncode()/cancel() are called from event handlers, not render, so they
  // read this instead of the `state` closure to avoid stale-closure bugs across re-renders.
  const stateRef = useRef<'idle' | 'recording' | 'encoding'>('idle');
  const setPhase = (s: 'idle' | 'recording' | 'encoding') => { stateRef.current = s; setState(s); };

  // getUserMedia's permission prompt can outlive the gesture that requested it (mainly the
  // very first grant on a device). If the gesture concludes (cancel, or an immediate
  // stop-and-encode) before that prompt resolves, `start()` must not go on to open the mic
  // with nobody left to tear it down. `runId` is bumped by cancel() to invalidate an
  // in-flight start(); `startInFlight` lets stopAndEncode() wait for that same start() to
  // finish setting up the recorder before trying to stop it.
  const runId = useRef(0);
  const startInFlight = useRef<Promise<void> | null>(null);

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    stream.current?.getTracks().forEach((t) => t.stop()); // mic indicator MUST go off
    stream.current = null;
    recorder.current = null;
    chunks.current = [];
    cappedBlob.current = undefined;
    void audioCtx.current?.close();
    audioCtx.current = null;
    setLevel(0);
    setSeconds(0);
  }, []);

  const start = useCallback((): Promise<void> => {
    if (!supported || stateRef.current !== 'idle') return Promise.resolve();
    if (startInFlight.current) return startInFlight.current; // permission prompt already pending
    const myRun = ++runId.current;
    const p = (async () => {
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return; // denied/unavailable — stay idle; the caller sees stopAndEncode() return null
      }
      if (myRun !== runId.current) {
        // The gesture ended (cancel()) while the permission prompt was pending — never
        // let this stream go live with nothing left to stop it.
        media.getTracks().forEach((t) => t.stop());
        return;
      }

      stream.current = media;
      try {
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
        setPhase('recording');

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
          if (s >= MAX_CLIP_SECONDS) {
            recorder.current?.stop(); // onstop caches the blob; stopAndEncode() picks it up whenever it's called
            // Stop ticking: without this the interval outlives the recording (the user may
            // still be holding) and `seconds` climbs past the cap forever.
            if (timer.current) { clearInterval(timer.current); timer.current = null; }
          }
        }, 1000);
      } catch {
        // MediaRecorder construction/start failed (unsupported codec, etc). getUserMedia
        // already granted a live stream at this point — without this catch it would stay
        // open forever with no MediaRecorder around to eventually stop() it.
        teardown();
        setPhase('idle');
      }
    })();
    startInFlight.current = p;
    void p.finally(() => { if (startInFlight.current === p) startInFlight.current = null; });
    return p;
  }, [supported]);

  const stopAndEncode = useCallback(async (): Promise<ArrayBuffer | null> => {
    if (startInFlight.current) await startInFlight.current; // let a pending permission prompt settle first
    const rec = recorder.current;
    if (!rec || stateRef.current !== 'recording') return null;
    setPhase('encoding');
    const blob = cappedBlob.current !== undefined
      ? cappedBlob.current // the MAX_CLIP_SECONDS timer already stopped + resolved this
      : await new Promise<Blob | null>((resolve) => {
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
      setPhase('idle');
    }
  }, [teardown]);

  const cancel = useCallback(() => {
    runId.current += 1; // invalidate a start() whose getUserMedia prompt hasn't resolved yet
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
    teardown();
    setPhase('idle');
  }, [teardown]);

  useEffect(() => () => { // unmount: never leave the mic hot
    runId.current += 1; // invalidate a start() whose getUserMedia prompt hasn't resolved yet
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    teardown();
  }, [teardown]);

  return { supported, state, level, seconds, start, stopAndEncode, cancel };
}
