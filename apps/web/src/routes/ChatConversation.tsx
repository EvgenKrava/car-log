import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Chip, CircularProgress, Container, IconButton, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { PageHeader } from '../components/ui/PageHeader';
import { Reveal } from '../components/ui/Reveal';
import { ChatBubble } from '../components/chat/ChatBubble';
import { VoiceComposerButton } from '../components/chat/VoiceComposerButton';
import { RecordingBar } from '../components/chat/RecordingBar';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import { useVoiceRecorder } from '../lib/useVoiceRecorder';
import { MAX_CLIP_SECONDS } from '../lib/wav-encode';
import { holdGestureReducer, holdOutcome, initialHoldState, HOLD_THRESHOLD_MS } from '../lib/hold-gesture';
import { useChatSession, useCreateChatSession, usePostChatMessage, useResolveChatAction, useTranscribe } from '../queries';

// One voice-flow notice at a time, rendered in the alerts strip above the composer.
// 'retry' carries the WAV that failed so its Retry action can re-post the exact same
// bytes; once a retry itself fails, `wav` is nulled — the ref is discarded, no further
// retry offered, but the "didn't catch that" message still explains the empty result.
type VoiceNotice = { kind: 'hint' } | { kind: 'retry'; wav: ArrayBuffer | null };

const MAX_ATTACH = 4;
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function ChatConversation() {
  const { t, i18n } = useTranslation(['chat', 'common']);
  const { id = '', sid = '' } = useParams();
  const navigate = useNavigate();

  const session = useChatSession(id, sid);
  const post = usePostChatMessage(id);
  const createSession = useCreateChatSession(id);
  const resolve = useResolveChatAction(id);

  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState<{ content: string; names: string[] } | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Stagger only the batch present at first render of THIS session; anything appended
  // later (a message you just sent) must appear immediately — index 0 — not inherit the
  // initial-load stagger. Keyed by sid so switching conversations re-captures the count.
  const initialLoad = useRef<{ sid: string; count: number } | null>(null);

  const speech = useSpeechRecognition();
  const [seconds, setSeconds] = useState(0);

  // Stream the live transcript into the editable field, so it can be corrected before sending.
  useEffect(() => {
    if (speech.listening && speech.transcript) setInput(speech.transcript);
  }, [speech.listening, speech.transcript]);

  useEffect(() => {
    if (!speech.listening) { setSeconds(0); return; }
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [speech.listening]);

  // Preferred voice path: hold-to-record + server transcription (Task 3). `speech` above
  // remains the fallback for browsers without MediaRecorder.
  const recorder = useVoiceRecorder();
  const transcribe = useTranscribe(id);
  const [hold, dispatchHold] = useReducer(holdGestureReducer, initialHoldState);
  const [voiceNotice, setVoiceNotice] = useState<VoiceNotice | null>(null);
  const [tooLong, setTooLong] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downXRef = useRef(0);
  const inputElRef = useRef<HTMLInputElement>(null);
  // Guards the MAX_CLIP_SECONDS auto-stop from being handled twice: the effect below fires
  // once per render while `recorder.seconds` stays pinned at the cap (the hook stops
  // ticking once it auto-stops), so without this it would keep re-triggering finishRecording.
  const cappedHandledRef = useRef(false);
  // Guards against finishRecording() being entered twice for the same clip: at the 60s cap,
  // the auto-stop effect calls it, and if the user's pointerup for the same gesture lands in
  // the same tick (batched), onMicPointerUp's outcome can still read 'record' before the
  // reducer reset from the effect is committed, calling it again. The second entry's
  // recorder.stopAndEncode() sees state already 'idle'/'encoding' and returns null, stamping
  // "didn't catch that" over what the first call is still transcribing successfully.
  const finishingRef = useRef(false);

  const voiceLang = (): 'uk-UA' | 'en-US' => (i18n.language.startsWith('uk') ? 'uk-UA' : 'en-US');

  // Posts one recorded clip for transcription and appends the result into the composer —
  // never auto-sends. `isRetry` controls what a failure does next: first failure keeps the
  // buffer for one retry; a second discards it (voiceNotice.wav becomes null).
  const runTranscription = async (wav: ArrayBuffer, isRetry: boolean) => {
    try {
      const text = (await transcribe.mutateAsync({ wav, language: voiceLang() })).trim();
      if (!text) { setVoiceNotice({ kind: 'retry', wav: isRetry ? null : wav }); return; }
      setVoiceNotice(null);
      setInput((v) => (v ? `${v} ${text}` : text));
      inputElRef.current?.focus();
    } catch {
      setVoiceNotice({ kind: 'retry', wav: isRetry ? null : wav });
    }
  };

  // Outcome `record`: stop the recorder, encode to WAV, and transcribe it. A null WAV
  // (nothing captured, or the decode/encode step failed) has no buffer to retry.
  const finishRecording = async () => {
    if (finishingRef.current) return; // see finishingRef comment above
    finishingRef.current = true;
    try {
      const wav = await recorder.stopAndEncode();
      if (!wav) { setVoiceNotice({ kind: 'retry', wav: null }); return; }
      await runTranscription(wav, false);
    } finally {
      finishingRef.current = false;
    }
  };

  const onRetryVoice = () => {
    if (voiceNotice?.kind === 'retry' && voiceNotice.wav) void runTranscription(voiceNotice.wav, true);
  };

  // Memoized so ChatBubble's React.memo (finding #7) actually holds — an inline arrow
  // here would be a new prop identity on every parent re-render, including the ~10/s
  // voice-level ticks the memo exists to filter out, defeating the memoization entirely.
  const onResolveAction = useCallback((aid: string, confirm: boolean) => {
    void resolve.mutateAsync({ sid, aid, confirm });
  }, [resolve, sid]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  };

  const onMicPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // A previous clip may still be transcribing, or (multi-touch) a second pointer might
    // land on the button while a recording gesture from the first is already underway —
    // either way, don't let a second gesture reset the reducer out from under the first.
    if (transcribe.isPending || recorder.state !== 'idle') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    downXRef.current = e.clientX;
    setTooLong(false);
    dispatchHold({ kind: 'down', at: Date.now() });
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      dispatchHold({ kind: 'holdTimer' });
      void recorder.start();
    }, HOLD_THRESHOLD_MS);
  };

  const onMicPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    dispatchHold({ kind: 'move', dx: e.clientX - downXRef.current });
  };

  const onMicPointerUp = () => {
    clearHoldTimer();
    const outcome = holdOutcome(hold, { kind: 'up', at: Date.now() });
    dispatchHold({ kind: 'up', at: Date.now() });
    if (outcome === 'hint') setVoiceNotice({ kind: 'hint' });
    else if (outcome === 'cancel') recorder.cancel();
    else if (outcome === 'record') void finishRecording();
  };

  // A system interruption (incoming call, app switch) fires pointercancel instead of
  // pointerup — must tear the mic down exactly like an explicit cancel, never leave it
  // waiting for a release that isn't coming. Call recorder.cancel() unconditionally
  // (not just when state !== 'idle'): start() is async and awaits the getUserMedia
  // permission prompt before flipping state to 'recording', so a pointercancel that
  // lands during that window would otherwise see state still 'idle', skip cancel(), and
  // let the in-flight start() go on to open the mic once the prompt resolves — with the
  // gesture already over and nothing left to stop it. cancel() safely no-ops if nothing
  // was actually running yet.
  const onMicPointerCancel = () => {
    clearHoldTimer();
    dispatchHold({ kind: 'reset' });
    recorder.cancel();
  };

  // The hook auto-stops MediaRecorder at MAX_CLIP_SECONDS on its own; from the gesture's
  // point of view the finger may still be down, so treat this exactly like a normal
  // release: end the gesture, surface the cap as its own info banner, and transcribe
  // whatever was captured.
  useEffect(() => {
    if (recorder.state === 'idle') { cappedHandledRef.current = false; return; }
    if (recorder.state === 'recording' && recorder.seconds >= MAX_CLIP_SECONDS && !cappedHandledRef.current) {
      cappedHandledRef.current = true;
      clearHoldTimer();
      dispatchHold({ kind: 'reset' });
      setTooLong(true);
      void finishRecording();
    }
  }, [recorder.state, recorder.seconds]);

  // Short tap (didn't clear HOLD_THRESHOLD_MS) → show the hint, then auto-dismiss.
  useEffect(() => {
    if (voiceNotice?.kind !== 'hint') return;
    const timer = window.setTimeout(() => setVoiceNotice(null), 2000);
    return () => window.clearTimeout(timer);
  }, [voiceNotice]);

  // Unmount while the finger is still down but before HOLD_THRESHOLD_MS has elapsed (e.g.
  // navigating away mid-press): the pending holdTimerRef timeout is a bare setTimeout, not
  // tied to this effect, so without clearing it here it fires after unmount and calls
  // recorder.start() — opening the mic with the button (and every handler that could ever
  // stop it) already gone. recorder's own unmount effect only guards what it already
  // started; it can't see this still-pending timer.
  useEffect(() => () => clearHoldTimer(), []);

  const backToList = () => navigate(`/cars/${id}?tab=chat`);

  // Stale/expired/deleted session → return to the list.
  useEffect(() => {
    if (session.isError) backToList();
  }, [session.isError]);

  const messages = session.data?.messages ?? [];
  if (initialLoad.current?.sid !== sid && messages.length > 0) {
    initialLoad.current = { sid, count: messages.length };
  }
  const initialCount = initialLoad.current?.sid === sid ? initialLoad.current.count : 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pending, post.isPending]);

  const onPickFiles = (fl: FileList | null) => {
    setAttachError(null);
    if (!fl) return;
    const picked = Array.from(fl);
    const room = MAX_ATTACH - files.length;
    if (picked.length > room) setAttachError(t('chat:attachTooMany', { max: MAX_ATTACH }));
    setFiles((prev) => [...prev, ...picked.slice(0, Math.max(0, room))]);
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && files.length === 0) || post.isPending) return;
    if (speech.listening) speech.stop();
    const sentFiles = files;
    const rawInput = input;
    setPending({ content: text, names: sentFiles.map((f) => f.name) });
    setInput('');
    setFiles([]);
    try {
      await post.mutateAsync({ sid, content: text, files: sentFiles });
    } catch {
      setInput(rawInput);
      setFiles(sentFiles);
    } finally {
      setPending(null);
    }
  };

  const startNewChat = async () => {
    const s = await createSession.mutateAsync();
    navigate(`/cars/${id}/chat/${s.id}`);
  };

  const suggestions = [t('chat:suggestionRemind'), t('chat:suggestionSpend'), t('chat:suggestionDue'), t('chat:suggestionSummary')];

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <PageHeader
        title={session.data?.title || t('chat:newChat')}
        onBack={backToList}
        actions={<IconButton onClick={startNewChat} aria-label={t('chat:newChat')} disabled={createSession.isPending} color="inherit"><AddIcon /></IconButton>}
      />
      <Container maxWidth="md" sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', py: 2 }}>
        <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
          {session.isLoading ? (
            <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={22} /></Stack>
          ) : messages.length === 0 && !pending ? (
            <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center', py: 4, px: 2, color: 'text.secondary' }}>
              <Box sx={{ width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'primary.main',
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.16)' : 'rgba(91,91,214,0.08)') }}>
                <SmartToyOutlinedIcon />
              </Box>
              <Typography variant="body2">{t('chat:empty')}</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 1 }}>
                {suggestions.map((s) => <Chip key={s} label={s} variant="outlined" onClick={() => setInput(s)} sx={{ cursor: 'pointer' }} />)}
              </Stack>
            </Stack>
          ) : (
            <Stack spacing={2}>
              {messages.map((m, i) => (
                <Reveal key={i} index={i < initialCount ? Math.max(0, i - (initialCount - 10)) : 0}>
                  <ChatBubble {...m}
                    resolving={resolve.isPending}
                    onResolveAction={onResolveAction} />
                </Reveal>
              ))}
              {pending ? (
                <Reveal>
                  <ChatBubble role="user" content={pending.content} createdAt="" actions={[]}
                    attachments={pending.names.map((n, i) => ({ key: `p${i}`, contentType: 'application/pdf' as const, filename: n, size: 0, url: '#' }))} />
                </Reveal>
              ) : null}
            </Stack>
          )}
          {post.isPending ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', px: 0.5, mt: 1 }}>
              <CircularProgress size={14} /><Typography variant="caption">{t('chat:thinking')}</Typography>
            </Stack>
          ) : null}
          <div ref={endRef} />
        </Box>

        {post.isError ? <Alert severity="error" sx={{ mb: 1 }}>{t('chat:error')}</Alert> : null}
        {resolve.isError ? <Alert severity="error" sx={{ mb: 1 }}>{t('chat:actionError')}</Alert> : null}
        {attachError ? <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setAttachError(null)}>{attachError}</Alert> : null}
        {speech.error ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {speech.error === 'denied' ? t('chat:voiceDenied') : t('chat:error')}
          </Alert>
        ) : recorder.error ? (
          // Hold-to-record path: getUserMedia was rejected (mic denied, or any other
          // failure — no device, already in use, insecure context). Previously this had
          // no wiring at all and the gesture silently produced nothing.
          <Alert severity="warning" sx={{ mb: 1 }}>
            {recorder.error === 'denied' ? t('chat:voiceDenied') : t('chat:voiceRetry')}
          </Alert>
        ) : null}
        {tooLong ? (
          <Alert severity="info" sx={{ mb: 1 }} onClose={() => setTooLong(false)}>{t('chat:voiceTooLong')}</Alert>
        ) : null}
        {voiceNotice?.kind === 'hint' ? (
          <Alert severity="info" sx={{ mb: 1 }}>{t('chat:voiceHoldHint')}</Alert>
        ) : null}
        {voiceNotice?.kind === 'retry' ? (
          <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setVoiceNotice(null)}
            action={voiceNotice.wav ? (
              <Button color="inherit" size="small" onClick={onRetryVoice}>{t('common:tryAgain')}</Button>
            ) : undefined}>
            {t('chat:voiceRetry')}
          </Alert>
        ) : null}

        {files.length > 0 ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
            {files.map((f, i) => (
              <Chip key={i} label={f.name} onDelete={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                icon={f.type === 'application/pdf' ? <InsertDriveFileOutlinedIcon /> : undefined} size="small" sx={{ maxWidth: 200 }} />
            ))}
          </Stack>
        ) : null}

        <Box component="form" onSubmit={(e) => { e.preventDefault(); void send(); }} sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end' }}>
          <input ref={fileInputRef} type="file" accept={ACCEPT} multiple hidden
            onChange={(e) => { onPickFiles(e.target.files); e.target.value = ''; }} />
          {recorder.state !== 'idle' || transcribe.isPending ? (
            <RecordingBar seconds={recorder.seconds} level={recorder.level}
              cancelling={hold.phase === 'cancelling'} transcribing={transcribe.isPending} />
          ) : (
            <>
              <IconButton onClick={() => fileInputRef.current?.click()} aria-label={t('chat:attach')} disabled={files.length >= MAX_ATTACH}><AttachFileIcon /></IconButton>
              <TextField fullWidth size="small" multiline maxRows={5} value={input}
                inputRef={inputElRef}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={t('chat:placeholder')} aria-label={t('chat:placeholder')}
                // While dictating (Web Speech fallback only), the streaming transcript is the
                // single writer of `input`; read-only (not disabled) keeps focus and full-color
                // text, just blocks typed edits. The hold-to-record path never streams into
                // `input` mid-recording, so it never needs this.
                InputProps={{ readOnly: speech.listening }} />
            </>
          )}
          <VoiceComposerButton
            recorderSupported={recorder.supported}
            recording={recorder.state !== 'idle'}
            transcribing={transcribe.isPending}
            cancelling={hold.phase === 'cancelling'}
            onPointerDown={onMicPointerDown}
            onPointerMove={onMicPointerMove}
            onPointerUp={onMicPointerUp}
            onPointerCancel={onMicPointerCancel}
            speechSupported={speech.supported}
            listening={speech.listening}
            speechSeconds={seconds}
            onSpeechStart={() => speech.start(voiceLang())}
            onSpeechStop={() => speech.stop()}
            canSend={Boolean(input.trim()) || files.length > 0}
            sending={post.isPending}
          />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', mt: 0.5 }}>{t('chat:disclaimer')}</Typography>
      </Container>
    </Box>
  );
}
