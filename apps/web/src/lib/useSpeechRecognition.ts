import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API is absent from TypeScript's DOM lib, so declare the slice we use.
// Hand-rolled rather than pulling @types/dom-speech-recognition for two interfaces —
// and no `any`, per the project's strict-TS rule.
type SpeechAlternative = { readonly transcript: string };
type SpeechResult = { readonly isFinal: boolean; readonly length: number; readonly 0: SpeechAlternative };
type SpeechResultList = { readonly length: number; readonly [index: number]: SpeechResult };
type SpeechResultEvent = { readonly resultIndex: number; readonly results: SpeechResultList };
type SpeechErrorEvent = { readonly error: string };

type SpeechRecognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognizerCtor = new () => SpeechRecognizer;

// Chrome/Edge expose the prefixed name; Safari 14.5+ exposes both.
const recognizerCtor = (): SpeechRecognizerCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognizerCtor;
    webkitSpeechRecognition?: SpeechRecognizerCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export type SpeechError = 'denied' | 'failed';

// Browser-native dictation. Nothing is uploaded — no backend, no cost, no audio storage.
// `transcript` accumulates final results and appends the live interim tail, so the caller
// can stream it into an editable field.
export function useSpeechRecognition() {
  const [supported] = useState(() => recognizerCtor() !== null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<SpeechError | null>(null);

  const recognizer = useRef<SpeechRecognizer | null>(null);
  const finalText = useRef('');
  // iOS Safari ends recognition after a short silence. While the user has not tapped
  // stop, restart so dictation doesn't die mid-sentence.
  const wantListening = useRef(false);

  const stop = useCallback(() => {
    wantListening.current = false;
    setListening(false);
    recognizer.current?.stop();
  }, []);

  const start = useCallback((language: string) => {
    const Ctor = recognizerCtor();
    if (!Ctor) return;

    // A recognizer may already be live (e.g. stop() was tapped, then start() again before
    // the first recognizer's graceful onend fired). Silence it immediately by detaching its
    // handlers and aborting, rather than leaving it running until its own onend arrives —
    // the identity checks below are a second line of defense in case any of its callbacks
    // are already queued.
    const prev = recognizer.current;
    if (prev) {
      prev.onresult = null;
      prev.onerror = null;
      prev.onend = null;
      prev.abort();
    }

    setError(null);
    finalText.current = '';
    setTranscript('');
    wantListening.current = true;

    const rec = new Ctor();
    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      if (recognizer.current !== rec) return; // superseded — do not write into the new session
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i]!;
        const text = result[0].transcript;
        if (result.isFinal) finalText.current = `${finalText.current}${text} `;
        else interim += text;
      }
      setTranscript(`${finalText.current}${interim}`.trimStart());
    };

    rec.onerror = (e) => {
      if (recognizer.current !== rec) return; // superseded — not our session anymore
      if (e.error === 'no-speech' || e.error === 'aborted') return; // the restart covers these
      const denied = e.error === 'not-allowed' || e.error === 'service-not-allowed';
      setError(denied ? 'denied' : 'failed');
      wantListening.current = false;
      setListening(false);
    };

    rec.onend = () => {
      if (recognizer.current !== rec) return; // superseded — a newer recognizer owns the mic now
      if (!wantListening.current) { setListening(false); return; }
      try {
        rec.start(); // silence-triggered end: keep going
      } catch {
        wantListening.current = false;
        setListening(false);
      }
    };

    recognizer.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError('failed');
      wantListening.current = false;
      setListening(false);
    }
  }, []);

  // Never leave the mic hot across a navigation.
  useEffect(() => () => {
    wantListening.current = false;
    const rec = recognizer.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.abort();
    }
  }, []);

  return { supported, listening, transcript, error, start, stop };
}
