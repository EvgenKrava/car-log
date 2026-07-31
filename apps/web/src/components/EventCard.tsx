import { useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Button, Chip, Stack, Typography, useTheme,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { useTranslation } from 'react-i18next';
import type { Event } from '@carlog/contracts';
import { formatNumber, formatDate } from '../i18n/format';
import { CATEGORY_META, categoryTint } from '../lib/event-category';
import { useDeleteEvent, useProofs } from '../queries';
import { EventFormDialog } from './EventFormDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ProofList } from './ProofList';

export function EventCard({ carId, event }: { carId: string; event: Event }) {
  const { t, i18n } = useTranslation(['event', 'common']);
  const theme = useTheme();
  const del = useDeleteEvent(carId);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const partsCount = event.works.reduce((n, w) => n + w.parts.length, 0);
  // Proof count for the collapsed-card cue. ProofList (rendered in the details
  // below) already subscribes to this exact query, and the accordion keeps its
  // children mounted — so this reuses the cached result, adding no request.
  const { data: proofs } = useProofs(carId, event.id);
  const proofCount = proofs?.length ?? 0;
  const { color, Icon } = CATEGORY_META[event.category];

  return (
    <Accordion
      disableGutters
      sx={{
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        mb: 1,
        '&:before': { display: 'none' },
        // MUI's default `:first-of-type` / `:last-of-type` selectors override our
        // borderRadius on the edge cards. Re-assert borderRadius at the same
        // specificity so every card looks identical.
        '&:first-of-type': { borderRadius: 2 },
        '&:last-of-type': { borderRadius: 2 },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', width: '100%' }}>
          <Chip
            icon={<Icon sx={{ fontSize: 15, color: `${color} !important` }} />}
            label={t(`event:category_${event.category}`)}
            size="small"
            sx={{ minWidth: 96, color, bgcolor: categoryTint(color, theme.palette.mode), border: 1, borderColor: 'transparent' }}
          />
          <Typography sx={{ fontWeight: 600 }}>{formatDate(`${event.date}T00:00:00.000Z`, i18n.language)}</Typography>
          {/* Imported/scanned events without a known odometer reading are stored as 0 —
              hide the meaningless "0" instead of rendering it. */}
          {event.mileage > 0 || event.cost > 0 ? (
            <Typography color="text.secondary">
              {[
                event.mileage > 0 ? formatNumber(event.mileage, i18n.language) : null,
                event.cost > 0 ? `${formatNumber(event.cost, i18n.language)} ${event.currency}` : null,
              ].filter(Boolean).join(' · ')}
            </Typography>
          ) : null}
          {/* Proof cue: shows at a glance which records are backed by a receipt/photo,
              without expanding the card. Pushed to the right on wide rows. */}
          {proofCount > 0 ? (
            <Stack direction="row" spacing={0.25} alignItems="center" sx={{ ml: 'auto', color: 'text.secondary' }}
              aria-label={t('event:proofCount', { count: proofCount })}>
              <AttachFileIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{proofCount}</Typography>
            </Stack>
          ) : null}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        {event.title ? <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{event.title}</Typography> : null}
        {event.notes ? <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{event.notes}</Typography> : null}
        <Typography variant="subtitle2">{t('event:worksSummary', { works: event.works.length, parts: partsCount })}</Typography>
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {event.works.map((w, i) => (
            <Typography key={i} variant="body2">
              • {w.description}{w.parts.length ? ` — ${w.parts.map((p) => `${p.name}×${p.quantity}`).join(', ')}` : ''}
            </Typography>
          ))}
        </Stack>
        <ProofList carId={carId} eventId={event.id} />
        <Stack direction="row" spacing={1} sx={{ mt: 2, justifyContent: 'flex-end' }}>
          <Button size="small" variant="contained" onClick={() => setEditOpen(true)}>{t('common:edit')}</Button>
          <Button size="small" color="error" onClick={() => setConfirmOpen(true)}>{t('common:delete')}</Button>
        </Stack>
      </AccordionDetails>
      <EventFormDialog open={editOpen} onClose={() => setEditOpen(false)} carId={carId} mode="edit" event={event} />
      <ConfirmDialog open={confirmOpen} title={t('event:deleteTitle')} message={t('event:deleteConfirm')}
        confirmLabel={t('common:delete')} loading={del.isPending}
        onConfirm={async () => { await del.mutateAsync(event.id); setConfirmOpen(false); }}
        onClose={() => setConfirmOpen(false)} />
    </Accordion>
  );
}
