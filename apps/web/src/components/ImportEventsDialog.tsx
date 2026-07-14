import { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { EVENT_CATEGORIES, type CandidateEvent } from '@carlog/contracts';
import { useExtractEvents, useCreateEvent } from '../queries';

type Phase = 'input' | 'review';

export function ImportEventsDialog({ carId, open, onClose }: { carId: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['import', 'event', 'common']);
  const extract = useExtractEvents(carId);
  const create = useCreateEvent(carId);
  const [phase, setPhase] = useState<Phase>('input');
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<CandidateEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  const reset = () => { setPhase('input'); setText(''); setDrafts([]); setError(null); setCommitting(false); };
  const close = () => { reset(); onClose(); };

  const onExtract = async () => {
    setError(null);
    try {
      const res = await extract.mutateAsync(text);
      setDrafts(res.events);
      setPhase('review');
    } catch (e) {
      const status = (e as Error).message;
      setError(status.includes('503') ? t('import:errorUnavailable') : t('import:errorFailed'));
    }
  };

  const patch = (i: number, p: Partial<CandidateEvent>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...p } : d)));
  const remove = (i: number) => setDrafts((prev) => prev.filter((_, idx) => idx !== i));

  const onCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      for (const d of drafts) { await create.mutateAsync(d); }
      close();
    } catch {
      setError(t('import:errorFailed'));
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{t('import:title')}</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {phase === 'input' ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">{t('import:instructions')}</Typography>
            <TextField
              label={t('import:textLabel')} value={text} onChange={(e) => setText(e.target.value)}
              multiline minRows={6} fullWidth inputProps={{ maxLength: 10000 }}
            />
          </Stack>
        ) : drafts.length === 0 ? (
          <Typography color="text.secondary" sx={{ mt: 1 }}>{t('import:empty')}</Typography>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="subtitle2">{t('import:reviewTitle', { count: drafts.length })}</Typography>
            {drafts.map((d, i) => (
              <Box key={i} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                <Stack direction="row" justifyContent="flex-end">
                  <IconButton size="small" aria-label={t('import:remove')} onClick={() => remove(i)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
                <Stack spacing={1.5}>
                  <TextField label={t('event:category')} select size="small" value={d.category}
                    onChange={(e) => patch(i, { category: e.target.value as CandidateEvent['category'] })} fullWidth>
                    {EVENT_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{t(`event:category_${c}`)}</MenuItem>)}
                  </TextField>
                  <Stack direction="row" spacing={1.5}>
                    <TextField label={t('event:date')} type="date" size="small" value={d.date}
                      onChange={(e) => patch(i, { date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
                    <TextField label={t('event:mileage')} type="number" size="small" value={d.mileage}
                      onChange={(e) => patch(i, { mileage: Number(e.target.value) })} fullWidth />
                  </Stack>
                  <Stack direction="row" spacing={1.5}>
                    <TextField label={t('event:cost')} type="number" size="small" value={d.cost}
                      onChange={(e) => patch(i, { cost: Number(e.target.value) })} fullWidth />
                    <TextField label={t('event:title')} size="small" value={d.title ?? ''}
                      onChange={(e) => patch(i, { title: e.target.value })} fullWidth />
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('import:cancel')}</Button>
        {phase === 'input' ? (
          <Button variant="contained" onClick={() => void onExtract()} disabled={!text.trim() || extract.isPending}>
            {extract.isPending ? t('import:extracting') : t('import:extract')}
          </Button>
        ) : (
          <Button variant="contained" onClick={() => void onCommit()} disabled={drafts.length === 0 || committing}>
            {committing ? t('import:adding') : t('import:addAll', { count: drafts.length })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
