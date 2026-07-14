import { type ReactNode } from 'react';
import { AppBar, Box, IconButton, Toolbar, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export function PageHeader({
  title, onBack, actions,
}: { title: string; onBack?: () => void; actions?: ReactNode }) {
  return (
    <AppBar position="sticky">
      <Toolbar>
        {onBack ? (
          <IconButton edge="start" onClick={onBack} aria-label="Back" sx={{ mr: 1 }}>
            <ArrowBackIcon />
          </IconButton>
        ) : null}
        <Typography variant="h6" sx={{ flexGrow: 1 }}>{title}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>{actions}</Box>
      </Toolbar>
    </AppBar>
  );
}
