import { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, IconButton, LinearProgress, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { NumberField } from './ui/NumberField';
import { WorksSummary } from './ui/WorksSummary';
import { Modal } from './ui/Modal';
import { EVENT_CATEGORIES, IMPORT_INLINE_MAX, IMPORT_FILE_MAX, type CandidateEvent, type ImportJob } from '@carlog/contracts';
import { useCreateImportJob, useImportJob, useLatestImportJob, useDeleteImportJob, useCreateEvent } from '../queries';

type Phase = 'input' | 'progress' | 'review';

export function ImportEventsDialog({ carId, open, onClose }: { carId: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['import', 'event', 'common']);
  const create = useCreateEvent(carId);
  const createJob = useCreateImportJob(carId);
  const deleteJob = useDeleteImportJob(carId);
  const [phase, setPhase] = useState<Phase>('input');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<CandidateEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSeededReview = useRef(false);
  const processedLatestJobId = useRef<string | null>(null);
  const prevCarId = useRef(carId);

  const job = useImportJob(carId, jobId ?? undefined);
  const latestJob = useLatestImportJob(carId, open && !jobId);

  const reset = () => {
    setPhase('input');
    setText('');
    setFile(null);
    setJobId(null);
    setDrafts([]);
    setError(null);
    setCommitting(false);
    setShowResumeBanner(false);
    hasSeededReview.current = false;
    processedLatestJobId.current = null;
  };
  const hideDialog = () => { onClose(); };
  const close = () => { reset(); onClose(); };

  const seedReview = (events: CandidateEvent[]) => {
    setDrafts(events);
    hasSeededReview.current = true;
    setPhase('review');
  };

  // Guard: reset local state if carId changes while dialog holds job state
  useEffect(() => {
    if (prevCarId.current !== carId) {
      prevCarId.current = carId;
      reset();
    }
  }, [carId]);

  // Resume logic: when dialog opens with no local job, check for latest job
  useEffect(() => {
    if (!open || jobId) return;
    if (!latestJob.data) return;
    if (processedLatestJobId.current === latestJob.data.id) return;
    const j = latestJob.data;
    processedLatestJobId.current = j.id;
    if (j.status === 'pending' || j.status === 'running') {
      setJobId(j.id);
      setPhase('progress');
      setShowResumeBanner(true);
      setError(null);
    } else if (j.status === 'completed') {
      setJobId(j.id);
      if (j.events.length > 0 && !hasSeededReview.current) {
        seedReview(j.events);
      } else {
        setPhase('review');
      }
      setShowResumeBanner(true);
      setError(null);
    } else if (j.status === 'failed') {
      const msg = j.error ? t(`import:jobFailed_${j.error}`, t('import:errorFailed')) : t('import:errorFailed');
      setError(msg);
      setPhase('input');
    }
  }, [open, jobId, latestJob.data, t]);

  // Progress → review transition
  useEffect(() => {
    if (phase !== 'progress' || !job.data) return;
    const j = job.data;
    if (j.status === 'completed') {
      if (j.events.length > 0 && !hasSeededReview.current) {
        seedReview(j.events);
      } else {
        setPhase('review');
      }
    } else if (j.status === 'failed') {
      const msg = j.error ? t(`import:jobFailed_${j.error}`, t('import:errorFailed')) : t('import:errorFailed');
      setError(msg);
      // Keep phase as progress so user can see partial results if any
    }
  }, [phase, job.data, t]);

  // Validate and stage a picked/dropped file. Shared by the file <input> (click) and the
  // dropzone's drag-and-drop handler so both paths behave identically.
  const handleFile = (selected: File) => {
    // The importer reads the file as UTF-8 text, so accept any text-like file
    // (.txt/.md/.csv/.log and any text/* MIME), not just .txt. Binary docs (PDF/images)
    // go through "Scan invoice" instead.
    const nameLower = selected.name.toLowerCase();
    const isText = selected.type.startsWith('text/')
      || selected.type === '' // some OSes report no MIME for .md/.log
      || /\.(txt|md|markdown|csv|log|text)$/i.test(nameLower);
    if (!isText) {
      setError(t('import:notTxt'));
      setFile(null);
      return;
    }
    if (selected.size > IMPORT_FILE_MAX) {
      setError(t('import:fileTooLargeTxt'));
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

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onStartImport = async () => {
    setError(null);
    try {
      const result = await createJob.mutateAsync(file ? { file } : { text });
      setJobId(result.jobId);
      setPhase('progress');
      hasSeededReview.current = false;
    } catch (e) {
      const status = (e as Error).message;
      setError(status.includes('503') ? t('import:errorUnavailable') : t('import:errorFailed'));
    }
  };

  const onStartNew = () => {
    reset();
    // reset() clears processedLatestJobId, which would let the resume effect immediately
    // re-adopt the SAME latest job and bounce the user straight back — defeating "start
    // new". Pin the current latest job's id as already-processed so resume skips it and
    // the fresh input phase sticks.
    if (latestJob.data) processedLatestJobId.current = latestJob.data.id;
  };

  const patch = (i: number, p: Partial<CandidateEvent>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...p } : d)));
  const remove = (i: number) => setDrafts((prev) => prev.filter((_, idx) => idx !== i));

  const onCommit = async () => {
    setCommitting(true);
    setError(null);
    // Commit against a snapshot; drop each candidate from the visible list the moment it's
    // created so the user watches the list shrink and a retry never re-creates a committed
    // one. On a mid-loop failure the created prefix is already gone and the failed+remaining
    // candidates stay for retry.
    const pending = drafts;
    for (let i = 0; i < pending.length; i += 1) {
      const candidate = pending[i]!;
      try {
        // Coerce an unfilled (undefined) mileage to 0 only at commit — the create route
        // requires a number, but we never fabricated 0 during review.
        await create.mutateAsync({ ...candidate, mileage: candidate.mileage ?? 0 });
        setDrafts((prev) => prev.filter((d) => d !== candidate));
      } catch {
        setError(t('import:errorFailed'));
        setCommitting(false);
        return;
      }
    }
    // Every candidate is now in the timeline — dismiss the server-side job so reopening bulk
    // import starts clean instead of re-adopting this completed job and re-seeding the same
    // (already-added) events. Best-effort: the 24h TTL is the backstop if this delete fails.
    if (jobId) {
      try { await deleteJob.mutateAsync(jobId); } catch { /* TTL will reap it */ }
    }
    setCommitting(false);
    close();
  };

  const renderProgress = (j: ImportJob) => {
    const { done, total, found } = j.progress;
    const pct = total > 0 ? (done / total) * 100 : undefined;
    return (
      <Stack spacing={2} sx={{ mt: 1 }}>
        <LinearProgress variant={pct !== undefined ? 'determinate' : 'indeterminate'} value={pct} />
        <Typography variant="body2" color="text.secondary" align="center">
          {pct !== undefined ? t('import:progressChunks', { done, total, found }) : t('import:preparing')}
        </Typography>
      </Stack>
    );
  };

  return (
    <Modal
      open={open}
      onClose={(phase === 'progress' || phase === 'review') ? hideDialog : close}
      title={t('import:title')}
      actions={
        <>
          {phase === 'progress' || (phase === 'review' && showResumeBanner) ? (
            <Button onClick={onStartNew}>{t('import:startNew')}</Button>
          ) : null}
          {phase === 'input' ? (
            <>
              <Button onClick={close}>{t('import:cancel')}</Button>
              <Button
                variant="contained"
                onClick={() => void onStartImport()}
                disabled={(!text.trim() && !file) || createJob.isPending}
              >
                {t('import:startImport')}
              </Button>
            </>
          ) : phase === 'progress' ? (
            <>
              {job.data?.status === 'failed' && job.data.events.length > 0 ? (
                <Button variant="contained" onClick={() => { if (job.data) seedReview(job.data.events); }}>
                  {t('import:addAll', { count: job.data.events.length })}
                </Button>
              ) : null}
              <Button onClick={hideDialog}>{t('import:hide')}</Button>
            </>
          ) : (
            <>
              <Button onClick={hideDialog}>{t('import:cancel')}</Button>
              <Button variant="contained" onClick={() => void onCommit()}
                disabled={drafts.length === 0 || committing || drafts.some((d) => !d.date)}>
                {committing ? t('import:adding') : t('import:addAll', { count: drafts.length })}
              </Button>
            </>
          )}
        </>
      }
    >
        {showResumeBanner && phase !== 'input' ? (
          <Alert severity="info" sx={{ mb: 2 }}>{t('import:resumeBanner')}</Alert>
        ) : null}
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {phase === 'input' ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">{t('import:instructions')}</Typography>
            <TextField
              label={t('import:textLabel')} value={text} onChange={(e) => setText(e.target.value)}
              multiline minRows={6} fullWidth inputProps={{ maxLength: IMPORT_INLINE_MAX }}
            />
            <Box>
              <input
                ref={fileInputRef}
                type="file"
                accept="text/*,.txt,.md,.markdown,.csv,.log"
                onChange={onFileSelect}
                style={{ display: 'none' }}
              />
              {/* Tappable + droppable target — drag-and-drop and click funnel through the
                  same handleFile validation. */}
              <Box
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                sx={{
                  border: '1px dashed', borderColor: (dragOver || file) ? 'primary.main' : 'divider', borderRadius: 3,
                  p: 2.5, textAlign: 'center', cursor: 'pointer',
                  bgcolor: dragOver ? 'action.selected' : 'action.hover',
                  transition: 'border-color 120ms, background-color 120ms', '&:hover': { borderColor: 'primary.main' },
                }}
              >
                <Typography sx={{ fontWeight: 600 }}>
                  {file ? file.name : t('import:uploadTxt')}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {t('import:uploadHint')}
                </Typography>
              </Box>
              {file ? (
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                  <Typography variant="body2" color="text.secondary">{file.name}</Typography>
                  <IconButton size="small" onClick={clearFile}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ) : null}
            </Box>
          </Stack>
        ) : phase === 'progress' ? (
          job.data ? renderProgress(job.data) : <Typography color="text.secondary" sx={{ mt: 1 }}>{t('import:preparing')}</Typography>
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
                      onChange={(e) => patch(i, { date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth
                      required error={!d.date} helperText={!d.date ? t('import:dateRequired') : undefined} />
                    <NumberField label={t('event:mileage')} size="small" value={d.mileage}
                      onChange={(v) => patch(i, { mileage: v })} fullWidth />
                  </Stack>
                  <Stack direction="row" spacing={1.5}>
                    <NumberField label={t('event:cost')} size="small" value={d.cost}
                      onChange={(v) => patch(i, { cost: v ?? 0 })} fullWidth />
                    <TextField label={t('event:title')} size="small" value={d.title ?? ''}
                      onChange={(e) => patch(i, { title: e.target.value })} fullWidth />
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
