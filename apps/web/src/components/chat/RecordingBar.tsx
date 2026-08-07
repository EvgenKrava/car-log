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
