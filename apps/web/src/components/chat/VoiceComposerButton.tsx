import { useTranslation } from 'react-i18next';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import MicNoneIcon from '@mui/icons-material/MicNone';
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
  supported: boolean;
  listening: boolean;
  seconds: number;
  canSend: boolean;   // there is text or a file to send
  sending: boolean;
  onStart: () => void;
  onStop: () => void;
};

const mmss = (total: number): string =>
  `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

// The right-hand composer slot, Telegram-style: one button that swaps between mic and
// send rather than showing both. While dictating it becomes a red stop button + timer.
export function VoiceComposerButton({ supported, listening, seconds, canSend, sending, onStart, onStop }: Props) {
  const { t } = useTranslation(['chat']);

  if (listening) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        {/* Announced once when dictation starts, rather than putting aria-live on the
            ticking timer below, which would re-announce every second — an ARIA anti-pattern. */}
        <Box sx={visuallyHidden} role="status" aria-live="polite">{t('chat:voiceListening')}</Box>
        <Typography variant="caption" color="error" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {mmss(seconds)}
        </Typography>
        <IconButton color="error" onClick={onStop} aria-label={t('chat:voiceStop')} aria-pressed
          sx={{ animation: 'carlogPulse 1.4s ease-in-out infinite',
            '@keyframes carlogPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.45 } } }}>
          <StopCircleIcon />
        </IconButton>
      </Stack>
    );
  }

  // Mic replaces send only while there is nothing to send.
  if (supported && !canSend) {
    return (
      <IconButton onClick={onStart} aria-label={t('chat:voiceStart')} aria-pressed={false}>
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
