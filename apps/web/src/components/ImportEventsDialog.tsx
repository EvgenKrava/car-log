import { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, LinearProgress, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { EVENT_CATEGORIES, IMPORT_INLINE_MAX, IMPORT_FILE_MAX, type CandidateEvent, type ImportJob } from '@carlog/contracts';
import { useCreateImportJob, useImportJob, useLatestImportJob, useCreateEvent } from '../queries';

type Phase = 'input' | 'progress' | 'review';

export function ImportEventsDialog({ carId, open, onClose }: { carId: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['import', 'event', 'common']);
  const create = useCreateEvent(carId);
  const createJob = useCreateImportJob(carId);
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
  };
  const close = () => { reset(); onClose(); };

  // Resume logic: when dialog opens with no local job, check for latest job
  useEffect(() => {
    if (!open || jobId) return;
    if (!latestJob.data) return;
    const j = latestJob.data;
    if (j.status === 'pending' || j.status === 'running') {
      setJobId(j.id);
      setPhase('progress');
      setShowResumeBanner(true);
      setError(null);
    } else if (j.status === 'completed') {
      setJobId(j.id);
      if (j.events.length > 0 && !hasSeededReview.current) {
        setDrafts(j.events);
        hasSeededReview.current = true;
      }
      setPhase('review');
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
        setDrafts(j.events);
        hasSeededReview.current = true;
      }
      setPhase('review');
    } else if (j.status === 'failed') {
      const msg = j.error ? t(`import:jobFailed_${j.error}`, t('import:errorFailed')) : t('import:errorFailed');
      setError(msg);
      // Keep phase as progress so user can see partial results if any
    }
  }, [phase, job.data, t]);

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    // Client-side validation
    const isText = selected.type.includes('text/plain') || selected.name.endsWith('.txt');
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
  };

  const patch = (i: number, p: Partial<CandidateEvent>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...p } : d)));
  const remove = (i: number) => setDrafts((prev) => prev.filter((_, idx) => idx !== i));

  const onCommit = async () => {
    setCommitting(true);
    setError(null);
    // Commit against a snapshot and drop each draft only after it succeeds, so a retry
    // after a mid-loop failure re-sends only the events that were NOT yet created (no
    // duplicates). `create` invalidates the timeline query per success.
    const pending = drafts;
    for (let i = 0; i < pending.length; i += 1) {
      try {
        await create.mutateAsync(pending[i]!);
      } catch {
        setDrafts(pending.slice(i)); // keep the failed one + the rest for retry
        setError(t('import:errorFailed'));
        setCommitting(false);
        return;
      }
    }
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
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{t('import:title')}</DialogTitle>
      <DialogContent>
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
                accept=".txt,text/plain"
                onChange={onFileSelect}
                style={{ display: 'none' }}
              />
              <Button variant="outlined" onClick={() => fileInputRef.current?.click()}>
                {t('import:uploadTxt')}
              </Button>
              {file ? (
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                  <Typography variant="body2">{file.name}</Typography>
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
              <Button variant="contained" onClick={() => { setPhase('review'); if (job.data) { setDrafts(job.data.events); } hasSeededReview.current = true; }}>
                {t('import:addAll', { count: job.data.events.length })}
              </Button>
            ) : null}
            <Button onClick={close}>{t('import:hide')}</Button>
          </>
        ) : (
          <>
            <Button onClick={close}>{t('import:cancel')}</Button>
            <Button variant="contained" onClick={() => void onCommit()} disabled={drafts.length === 0 || committing}>
              {committing ? t('import:adding') : t('import:addAll', { count: drafts.length })}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
