import { useTranslation } from 'react-i18next';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import MicNoneIcon from '@mui/icons-material/MicNone';
import MicIcon from '@mui/icons-material/Mic';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import SendIcon from '@mui/icons-material/Send';

// @mui/utils isn't a direct dependency of this package (only @mui/material and
// @mui/icons-material are), so its `visuallyHidden` export doesn't resolve here. Same
// clip-rect recipe, kept local.
const visuallyHidden: SxProps<Theme> = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
};

type Props = {
  // Preferred path: the button IS the hold-to-record pointer-gesture target. The parent
  // owns the gesture reducer (hold-gesture.ts) and the recorder hook; this component just
  // wires the resulting handlers onto the actual DOM node so `setPointerCapture` (called
  // inside those handlers via `e.currentTarget`) targets the right element.
  recorderSupported: boolean;
  recording: boolean;     // recorder is in any non-idle phase — finger is presumed still down
  transcribing: boolean;  // a previous clip is still being transcribed — block a new gesture
  cancelling: boolean;    // slid past the cancel threshold
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
  // A system interruption (incoming call, app backgrounded) fires `pointercancel` instead
  // of `pointerup` — must be wired to the same teardown as an explicit cancel, or the mic
  // stays hot with nothing left listening for a release.
  onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => void;
  // Fallback: browsers without MediaRecorder use tap-to-toggle Web Speech dictation.
  speechSupported: boolean;
  listening: boolean;
  speechSeconds: number;
  onSpeechStart: () => void;
  onSpeechStop: () => void;
  // Shared
  canSend: boolean;   // there is text or a file to send
  sending: boolean;
};

const mmss = (total: number): string =>
  `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

// The right-hand composer slot, Telegram-style: one button that swaps between mic and
// send rather than showing both. Mic replaces send only while there is nothing to send —
// once mid-gesture (finger down) the mic stays put regardless, since the row it's part of
// has already swapped to the RecordingBar and there is no text field to submit from.
export function VoiceComposerButton({
  recorderSupported, recording, transcribing, cancelling, onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
  speechSupported, listening, speechSeconds, onSpeechStart, onSpeechStop,
  canSend, sending,
}: Props) {
  const { t } = useTranslation(['chat']);

  if (recorderSupported && recording) {
    return (
      <IconButton color="error" aria-label={t('chat:voiceSlideCancel')}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
        sx={{
          touchAction: 'none', // otherwise the browser hijacks the cancel-slide as a page scroll
          opacity: cancelling ? 0.45 : 1,
          animation: 'carlogPulse 1.4s ease-in-out infinite',
          '@keyframes carlogPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.45 } },
        }}>
        <MicIcon />
      </IconButton>
    );
  }

  if (recorderSupported && !canSend) {
    return (
      <IconButton aria-label={t('chat:voiceHoldHint')} disabled={transcribing}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
        sx={{ touchAction: 'none' }}>
        <MicNoneIcon />
      </IconButton>
    );
  }

  if (!recorderSupported && listening) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        {/* Announced once when dictation starts, rather than putting aria-live on the
            ticking timer below, which would re-announce every second — an ARIA anti-pattern. */}
        <Box sx={visuallyHidden} role="status" aria-live="polite">{t('chat:voiceListening')}</Box>
        <Typography variant="caption" color="error" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {mmss(speechSeconds)}
        </Typography>
        <IconButton color="error" onClick={onSpeechStop} aria-label={t('chat:voiceStop')} aria-pressed
          sx={{ animation: 'carlogPulse 1.4s ease-in-out infinite',
            '@keyframes carlogPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.45 } } }}>
          <StopCircleIcon />
        </IconButton>
      </Stack>
    );
  }

  if (!recorderSupported && speechSupported && !canSend) {
    return (
      <IconButton onClick={onSpeechStart} aria-label={t('chat:voiceStart')} aria-pressed={false}>
        <MicNoneIcon />
      </IconButton>
    );
  }

  return (
    <IconButton type="submit" color="primary" aria-label={t('chat:send')} disabled={!canSend || sending}>
      <SendIcon />
    </IconButton>
  );
}
