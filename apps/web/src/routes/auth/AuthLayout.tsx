import { type ReactNode } from 'react';
import { Box, Card, CardContent, Stack, Typography } from '@mui/material';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{title}</Typography>
            {children}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
