import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';

type Props = {
  title: string; body: string;
  primaryLabel: string; onPrimary: () => void;
  secondaryLabel?: string; secondaryHref?: string;
};

// Full-viewport centred card for terminal states (crash, 404). Plain anchors for the
// secondary action so it works even when the router itself is what crashed.
export function StatusCard({ title, body, primaryLabel, onPrimary, secondaryLabel, secondaryHref }: Props) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{title}</Typography>
            <Typography color="text.secondary">{body}</Typography>
            <Button variant="contained" onClick={onPrimary}>{primaryLabel}</Button>
            {secondaryLabel && secondaryHref ? <Button variant="text" href={secondaryHref}>{secondaryLabel}</Button> : null}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
