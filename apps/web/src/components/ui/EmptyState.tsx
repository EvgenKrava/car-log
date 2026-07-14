import { type ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';

export function EmptyState({
  title, description, action,
}: { title: string; description?: string; action?: ReactNode }) {
  return (
    <Stack alignItems="center" spacing={2} sx={{ py: 8, textAlign: 'center' }}>
      <Box sx={{
        width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center',
        bgcolor: 'action.hover', color: 'text.secondary',
      }}>
        <DirectionsCarIcon fontSize="large" />
      </Box>
      <Typography variant="h6">{title}</Typography>
      {description ? <Typography color="text.secondary">{description}</Typography> : null}
      {action}
    </Stack>
  );
}
