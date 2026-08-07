import { type ReactNode } from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export function StatusView({
  state, message, skeleton,
}: { state: 'loading' | 'error'; message?: string; skeleton?: ReactNode }) {
  const { t } = useTranslation(['common']);
  if (state === 'loading') {
    // Content-shaped placeholder when the caller provides one; spinner fallback for
    // operations and not-yet-upgraded consumers.
    if (skeleton != null) return <>{skeleton}</>;
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
