import { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';
import { useEvents } from '../queries';
import { EventCard } from './EventCard';
import { EventFormDialog } from './EventFormDialog';
import { StatusView } from './ui/StatusView';

export function ServiceTimeline({ carId }: { carId: string }) {
  const { t } = useTranslation(['event']);
  const { data: events, isLoading, isError } = useEvents(carId);
  const [open, setOpen] = useState(false);

  const sorted = [...(events ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <Box sx={{ mt: 4 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">{t('event:sectionTitle')}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>{t('event:addService')}</Button>
      </Stack>
      {isLoading ? (
        <StatusView state="loading" />
      ) : isError ? (
        <StatusView state="error" message={t('event:loadError')} />
      ) : !sorted.length ? (
        <Typography color="text.secondary">{t('event:empty')}</Typography>
      ) : (
        <Box>{sorted.map((e) => <EventCard key={e.id} carId={carId} event={e} />)}</Box>
      )}
      <EventFormDialog open={open} onClose={() => setOpen(false)} carId={carId} mode="create" />
    </Box>
  );
}
