import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import type { ChatAction } from '@carlog/contracts';

type Props = {
  actions: ChatAction[];
  onResolve: (actionId: string, confirm: boolean) => void;
  busy: boolean;
};

// The side effects an assistant turn produced. `pending` entries are proposed deletes and
// render as a card with Confirm/Dismiss — nothing was deleted until the owner taps.
export function ChatActions({ actions, onResolve, busy }: Props) {
  const { t } = useTranslation(['chat']);
  if (actions.length === 0) return null;

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      {actions.map((a) => {
        if (a.status === 'pending') {
          return (
            <Box key={a.id} sx={{
              p: 1.25, borderRadius: 2, border: 1, borderColor: 'warning.main',
              bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255,167,38,0.10)' : 'rgba(255,167,38,0.08)'),
            }}>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'warning.main', mb: 0.5 }}>
                <HelpOutlineIcon sx={{ fontSize: 16 }} />
                <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('chat:actionPending')}</Typography>
              </Stack>
              <Typography variant="body2" sx={{ mb: 1 }}>{a.summary}</Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="contained" color="error" disabled={busy}
                  onClick={() => onResolve(a.id, true)}>{t('chat:actionConfirm')}</Button>
                <Button size="small" variant="text" disabled={busy}
                  onClick={() => onResolve(a.id, false)}>{t('chat:actionDismiss')}</Button>
              </Stack>
            </Box>
          );
        }

        const { icon, color, label, strike } = a.status === 'done'
          ? { icon: <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />, color: 'success.main', label: t('chat:actionDone'), strike: false }
          : a.status === 'declined'
            ? { icon: <RemoveCircleOutlineIcon sx={{ fontSize: 16 }} />, color: 'text.disabled', label: t('chat:actionDeclined'), strike: true }
            : { icon: <ErrorOutlineIcon sx={{ fontSize: 16 }} />, color: 'error.main', label: t('chat:actionFailed'), strike: false };

        return (
          <Stack key={a.id} direction="row" spacing={0.75} alignItems="flex-start" sx={{ color }}>
            <Box sx={{ mt: 0.25 }}>{icon}</Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>{label}</Typography>
              <Typography variant="body2" sx={{
                color: 'text.primary',
                textDecoration: strike ? 'line-through' : 'none',
              }}>{a.summary}</Typography>
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}
