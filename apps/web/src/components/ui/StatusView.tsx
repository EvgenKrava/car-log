import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export function StatusView({
  state, message,
}: { state: 'loading' | 'error'; message?: string }) {
  const { t } = useTranslation(['common']);
  if (state === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 10, textAlign: 'center' }}>
      <Typography variant="h6">{t('common:loadingError')}</Typography>
      <Typography color="text.secondary">{message ?? t('common:tryAgain')}</Typography>
    </Stack>
  );
}
