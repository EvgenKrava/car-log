import { useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { EVENT_CATEGORIES, maxScanSize, type CandidateEvent } from '@carlog/contracts';
import { useExtractFromScan, useCreateEvent } from '../queries';
import { useAuth } from '../auth';
import { confirmProofFromScan } from '../api-client';

type Phase = 'input' | 'scanning' | 'review';

export function ScanInvoiceDialog({ carId, open, onClose }: { carId: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['import', 'event', 'common']);
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  const extractScan = useExtractFromScan(carId);
  const createEvent = useCreateEvent(carId);
  const [phase, setPhase] = useState<Phase>('input');
  const [file, setFile] = useState<File | null>(null);
  const [drafts, setDrafts] = useState<CandidateEvent[]>([]);
  const [scanData, setScanData] = useState<{ s3Key: string; contentType: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [attachWarning, setAttachWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase('input');
    setFile(null);
    setDrafts([]);
    setScanData(null);
    setError(null);
    setCommitting(false);
    setAttachWarning(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const close = () => {
    reset();
    onClose();
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    // IMPORTANT: HEIC is explicitly excluded — Claude vision cannot read it
    // Client-side supported types: image/jpeg, image/png, image/webp, application/pdf
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const nameLower = selected.name.toLowerCase();
    if (!supportedTypes.includes(selected.type) || nameLower.endsWith('.heic') || nameLower.endsWith('.heif')) {
      setError(t('import:scanBadType'));
      setFile(null);
      return;
    }

    if (selected.size > maxScanSize(selected.type)) {
      setError(t('import:scanTooLarge'));
      setFile(null);
      return;
    }

    setFile(selected);
    setError(null);
  };

  const onScan = async () => {
    if (!file) return;
    setError(null);
    setAttachWarning(false);
    setPhase('scanning');

    try {
      const { events, s3Key, contentType, size } = await extractScan.mutateAsync({ file });

      if (events.length === 0) {
        // Show unreadable message with manual entry option
        setError(t('import:scanUnreadable'));
        setPhase('input');
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      setScanData({ s3Key, contentType, size });
      setDrafts(events);
      setPhase('review');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('503')) {
        setError(t('import:errorUnavailable'));
      } else {
        setError(t('import:errorFailed'));
      }
      setPhase('input');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const patch = (i: number, p: Partial<CandidateEvent>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...p } : d)));

  const remove = (i: number) => setDrafts((prev) => prev.filter((_, idx) => idx !== i));

  const onCommit = async () => {
    if (!scanData) return;
    setCommitting(true);
    setError(null);
    setAttachWarning(false);

    // Committed-prefix retry: snapshot the drafts and drop each only after successful creation
    const pending = drafts;
    let attachFailed = false;

    for (let i = 0; i < pending.length; i += 1) {
      try {
        const created = await createEvent.mutateAsync(pending[i]!);

        // Try to attach the scan; if it fails, collect the warning but continue
        // The same s3Key is reused as the source for each event's proof copy (not deleted between events; lifecycle rule purges it after a day)
        try {
          await confirmProofFromScan(
            token,
            carId,
            created.id,
            scanData.s3Key,
            scanData.contentType,
            scanData.size
          );
        } catch {
          attachFailed = true;
        }
      } catch {
        // Event creation failed; keep the failed one + remainder for retry
        setDrafts(pending.slice(i));
        setError(t('import:errorFailed'));
        setCommitting(false);
        return;
      }
    }

    // All events committed; if any attach failed, show warning and require manual close
    setCommitting(false);
    if (attachFailed) {
      setAttachWarning(true);
      setDrafts([]);
    } else {
      close();
    }
  };

  return (
    <Dialog open={open} onClose={phase === 'scanning' ? undefined : close} maxWidth="sm" fullWidth>
      <DialogTitle>{t('import:scanInvoice')}</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {attachWarning ? <Alert severity="warning" sx={{ mb: 2 }}>{t('import:scanAttachFailed')}</Alert> : null}

        {phase === 'input' ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('import:instructions')}
            </Typography>
            <Box>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={onFileSelect}
                style={{ display: 'none' }}
              />
              <Button variant="outlined" onClick={() => fileInputRef.current?.click()}>
                {t('import:uploadTxt')}
              </Button>
              {file ? (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {file.name}
                </Typography>
              ) : null}
            </Box>
          </Stack>
        ) : phase === 'scanning' ? (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t('import:scanning')}
          </Typography>
        ) : drafts.length === 0 ? (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t('import:empty')}
          </Typography>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="subtitle2">
              {t('import:reviewTitle', { count: drafts.length })}
            </Typography>
            {drafts.map((d, i) => (
              <Box key={i} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                <Stack direction="row" justifyContent="flex-end">
                  <IconButton size="small" aria-label={t('import:remove')} onClick={() => remove(i)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <Stack spacing={1.5}>
                  <TextField
                    label={t('event:category')}
                    select
                    size="small"
                    value={d.category}
                    onChange={(e) => patch(i, { category: e.target.value as CandidateEvent['category'] })}
                    fullWidth
                  >
                    {EVENT_CATEGORIES.map((c) => (
                      <MenuItem key={c} value={c}>{t(`event:category_${c}`)}</MenuItem>
                    ))}
                  </TextField>
                  <Stack direction="row" spacing={1.5}>
                    <TextField
                      label={t('event:date')}
                      type="date"
                      size="small"
                      value={d.date}
                      onChange={(e) => patch(i, { date: e.target.value })}
                      InputLabelProps={{ shrink: true }}
                      fullWidth
                    />
                    <TextField
                      label={t('event:mileage')}
                      type="number"
                      size="small"
                      value={d.mileage}
                      onChange={(e) => patch(i, { mileage: Number(e.target.value) })}
                      fullWidth
                    />
                  </Stack>
                  <Stack direction="row" spacing={1.5}>
                    <TextField
                      label={t('event:cost')}
                      type="number"
                      size="small"
                      value={d.cost}
                      onChange={(e) => patch(i, { cost: Number(e.target.value) })}
                      fullWidth
                    />
                    <TextField
                      label={t('event:title')}
                      size="small"
                      value={d.title ?? ''}
                      onChange={(e) => patch(i, { title: e.target.value })}
                      fullWidth
                    />
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {phase === 'input' ? (
          <>
            <Button onClick={close}>{t('import:cancel')}</Button>
            <Button
              variant="contained"
              onClick={() => void onScan()}
              disabled={!file || extractScan.isPending}
            >
              {t('import:startImport')}
            </Button>
          </>
        ) : phase === 'scanning' ? null : (
          <>
            <Button onClick={close}>{t('import:cancel')}</Button>
            <Button
              variant="contained"
              onClick={() => void onCommit()}
              disabled={drafts.length === 0 || committing}
            >
              {committing ? t('import:adding') : t('import:addAll', { count: drafts.length })}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}