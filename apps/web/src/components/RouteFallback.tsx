import { Box, CircularProgress } from '@mui/material';

// Shown only while a lazily-loaded route chunk downloads (first visit). Data loading
// inside routes keeps using the skeleton components.
export function RouteFallback() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress />
    </Box>
  );
}
