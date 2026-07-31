import { useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner';
import { useTranslation } from 'react-i18next';
import { NumberField } from './ui/NumberField';
import { WorksSummary } from './ui/WorksSummary';
import { Modal } from './ui/Modal';
import { prepareScanFile } from '../lib/prepare-scan';
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
  // Validate and stage a picked/dropped file. Shared by the file <input> (click) and the
  // dropzone's drag-and-drop handler so both paths behave identically.
  const handleFile = (selected: File) => {
    // Accept any image (incl. HEIC/HEIF — converted to JPEG on scan) or a PDF. The raw
    // file isn't size-checked here: large photos are downscaled by prepareScanFile before
    // upload, so only the PREPARED file's size matters (checked in onScan).
    const nameLower = selected.name.toLowerCase();
    const isImage = selected.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(nameLower);
    const isPdf = selected.type === 'application/pdf' || nameLower.endsWith('.pdf');
    if (!isImage && !isPdf) {
      setError(t('import:scanBadType'));
      setFile(null);
      return;
    }
    // PDFs aren't downscaled, so enforce their cap up front.
    if (isPdf && selected.size > maxScanSize('application/pdf')) {
      setError(t('import:scanTooLarge'));
      setFile(null);
      return;
    }

    setFile(selected);
    setError(null);
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) handleFile(selected);
  };

  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleFile(dropped);
  };

  const onScan = async () => {
    if (!file) return;
    setError(null);
    setAttachWarning(false);
    setPhase('scanning');

    try {
      // Convert HEIC→JPEG and downscale large photos before upload (PDFs pass through).
      let prepared: File;
      try {
        prepared = await prepareScanFile(file);
      } catch {
        setError(t('import:scanBadType'));
        setPhase('input');
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      if (prepared.size > maxScanSize(prepared.type)) {
        setError(t('import:scanTooLarge'));
        setPhase('input');
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      const { events, s3Key, contentType, size } = await extractScan.mutateAsync({ file: prepared });

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

    // Snapshot the drafts; drop each from the visible list the moment its event is created
    // so the list shrinks as it commits and a retry never re-creates a committed one.
    const pending = drafts;
    let attachFailed = false;

    for (let i = 0; i < pending.length; i += 1) {
      const candidate = pending[i]!;
      try {
        // Coerce an unfilled (undefined) mileage to 0 only at commit (create route needs a number).
        const created = await createEvent.mutateAsync({ ...candidate, mileage: candidate.mileage ?? 0 });
        setDrafts((prev) => prev.filter((d) => d !== candidate));

        // Attach the scanned document to the new event; a failure is non-fatal — collect
        // the warning and continue. The same s3Key is reused as the copy source for every
        // event's proof (not deleted between events; the lifecycle rule purges it after a day).
        try {
          await confirmProofFromScan(token, carId, created.id, scanData.s3Key, scanData.contentType, scanData.size);
        } catch {
          attachFailed = true;
        }
      } catch {
        // Event creation failed; the created prefix is already removed, so the failed one
        // plus the remainder stay for retry.
        setError(t('import:errorFailed'));
        setCommitting(false);
        return;
      }
    }

    setCommitting(false);
    if (attachFailed) {
      setAttachWarning(true); // keep the dialog open so the warning is seen
    } else {
      close();
    }
  };

  return (
    <Modal
      open={open}
      onClose={phase === 'scanning' ? undefined : close}
      title={t('import:scanInvoice')}
      actions={
        phase === 'scanning' ? null : phase === 'input' ? (
          <>
            <Button onClick={close}>{t('import:cancel')}</Button>
            <Button
              variant="contained"
              onClick={() => void onScan()}
              disabled={!file || extractScan.isPending}
            >
              {t('import:scanStart')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close}>{t('import:cancel')}</Button>
            <Button
              variant="contained"
              onClick={() => void onCommit()}
              disabled={drafts.length === 0 || committing || drafts.some((d) => !d.date)}
            >
              {committing ? t('import:adding') : t('import:addAll', { count: drafts.length })}
            </Button>
          </>
        )
      }
    >
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {attachWarning ? <Alert severity="warning" sx={{ mb: 2 }}>{t('import:scanAttachFailed')}</Alert> : null}

        {phase === 'input' ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('import:scanInstructions')}
            </Typography>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,.heic,.heif"
              onChange={onFileSelect}
              style={{ display: 'none' }}
            />
            {/* Tappable + droppable target — one big zone that reads as "put a document here".
                Drag-and-drop and click-to-pick funnel through the same handleFile validation. */}
            <Box
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              sx={{
                border: '1px dashed', borderColor: (dragOver || file) ? 'primary.main' : 'divider', borderRadius: 3,
                p: 3, textAlign: 'center', cursor: 'pointer',
                bgcolor: dragOver ? 'action.selected' : 'action.hover',
                transition: 'border-color 120ms, background-color 120ms', '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <DocumentScannerIcon color={file ? 'primary' : 'action'} sx={{ fontSize: 40, mb: 1 }} />
              <Typography sx={{ fontWeight: 600 }}>
                {file ? file.name : t('import:scanPickCta')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {t('import:scanPickHint')}
              </Typography>
            </Box>
          </Stack>
        ) : phase === 'scanning' ? (
          <Stack spacing={2} alignItems="center" sx={{ py: 4 }}>
            <CircularProgress />
            <Typography color="text.secondary">{t('import:scanning')}</Typography>
          </Stack>
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
                      required
                      error={!d.date}
                      helperText={!d.date ? t('import:dateRequired') : undefined}
                      fullWidth
                    />
                    <NumberField
                      label={t('event:mileage')}
                      size="small"
                      value={d.mileage}
                      onChange={(v) => patch(i, { mileage: v })}
                      fullWidth
                    />
                  </Stack>
                  <Stack direction="row" spacing={1.5}>
                    <NumberField
                      label={t('event:cost')}
                      size="small"
                      value={d.cost}
                      onChange={(v) => patch(i, { cost: v ?? 0 })}
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
                  <WorksSummary works={d.works} />
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
    </Modal>
  );
}