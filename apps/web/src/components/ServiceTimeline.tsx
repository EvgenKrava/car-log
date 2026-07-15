import { useState } from 'react';
import {
  Box, Button, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { useTranslation } from 'react-i18next';
import { useEvents } from '../queries';
import { EventCard } from './EventCard';
import { EventFormDialog } from './EventFormDialog';
import { StatusView } from './ui/StatusView';

// `addOpen`/`onAddOpenChange` let a parent (Vehicle) drive the manual "add service" dialog.
// `onScan`/`onImport` let the parent also wire the other two ingestion paths — when all
// three are provided the title shows an "Add" button opening a 3-option menu (matching the
// SpeedDial). When the callbacks are omitted the component stands alone with its own inline
// "Add service" button and self-managed manual dialog.
export function ServiceTimeline({
  carId, addOpen, onAddOpenChange, onScan, onImport,
}: {
  carId: string;
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
  onScan?: () => void;
  onImport?: () => void;
}) {
  const { t } = useTranslation(['event', 'import']);
  const { data: events, isLoading, isError } = useEvents(carId);
  const [selfOpen, setSelfOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const controlled = onAddOpenChange !== undefined;
  const open = controlled ? Boolean(addOpen) : selfOpen;
  const setOpen = (v: boolean) => (controlled ? onAddOpenChange!(v) : setSelfOpen(v));
  // The 3-option menu needs all three actions wired; otherwise fall back to the plain button.
  const hasMenu = Boolean(onScan && onImport);

  const sorted = [...(events ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <Box sx={{ mt: 4 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">{t('event:sectionTitle')}</Typography>
        {hasMenu ? (
          <>
            <Button variant="contained" startIcon={<AddIcon />} onClick={(e) => setMenuAnchor(e.currentTarget)}>
              {t('event:addRecord')}
            </Button>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
              <MenuItem onClick={() => { setMenuAnchor(null); onScan!(); }}>
                <ListItemIcon><DocumentScannerIcon fontSize="small" /></ListItemIcon>
                <ListItemText>{t('event:addScan')}</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => { setMenuAnchor(null); onImport!(); }}>
                <ListItemIcon><TextSnippetIcon fontSize="small" /></ListItemIcon>
                <ListItemText>{t('event:addBulk')}</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => { setMenuAnchor(null); setOpen(true); }}>
                <ListItemIcon><EditNoteIcon fontSize="small" /></ListItemIcon>
                <ListItemText>{t('event:addManual')}</ListItemText>
              </MenuItem>
            </Menu>
          </>
        ) : controlled ? null : (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>{t('event:addService')}</Button>
        )}
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
