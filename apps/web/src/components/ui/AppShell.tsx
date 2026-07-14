import { type ReactNode } from 'react';
import { Box } from '@mui/material';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {children}
      {/* Safe bottom padding so the FAB and InstallPrompt banner never cover content. */}
      <Box sx={{ height: 96 }} />
    </Box>
  );
}
