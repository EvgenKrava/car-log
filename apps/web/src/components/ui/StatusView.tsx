import { Box, CircularProgress, Stack, Typography } from '@mui/material';

export function StatusView({
  state, message,
}: { state: 'loading' | 'error'; message?: string }) {
  if (state === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 10, textAlign: 'center' }}>
      <Typography variant="h6">Something went wrong</Typography>
      <Typography color="text.secondary">{message ?? 'Please try again.'}</Typography>
    </Stack>
  );
}
