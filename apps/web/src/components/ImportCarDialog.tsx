import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Typography } from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { CarExportSchema, CAR_EXPORT_FORMAT, type CarExport } from '@carlog/contracts';
import { Modal } from './ui/Modal';
import { useImportCar } from '../queries';
import { formatDate } from '../i18n/format';

type ParseResult =
  | { kind: 'ok'; file: CarExport }
  | { kind: 'badFile' }
  | { kind: 'newerVersion' }
  | { kind: 'corrupt' };

// Distinguish "not our file at all" from "our file, newer version" so the error
// message can tell the user to update instead of blaming the file.
function parseExport(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { kind: 'badFile' }; }
  const parsed = CarExportSchema.safeParse(raw);
  if (parsed.success) return { kind: 'ok', file: parsed.data };
  const looksOurs = typeof raw === 'object' && raw !== null
    && (raw as { format?: unknown }).format === CAR_EXPORT_FORMAT;
  const version = typeof (raw as { version?: unknown }).version === 'number'
    ? (raw as { version: number }).version
    : undefined;
  const newer = looksOurs && typeof version === 'number' && version > 1;
  if (looksOurs && (version === 1 || version === undefined)) return { kind: 'corrupt' };
  return newer ? { kind: 'newerVersion' } : { kind: 'badFile' };
}

export function ImportCarDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation(['garage', 'common']);
  const navigate = useNavigate();
  const importCar = useImportCar();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<CarExport | null>(null);
  const [error, setError] = useState<'badFile' | 'newerVersion' | 'corrupt' | 'failed' | null>(null);

  const reset = () => { setPicked(null); setError(null); };
  const close = () => { reset(); onClose(); };

  const onPick = async (fl: FileList | null) => {
    reset();
    const f = fl?.[0];
    if (!f) return;
    const result = parseExport(await f.text());
    if (result.kind === 'ok') setPicked(result.file);
    else setError(result.kind);
  };

  const doImport = async () => {
    if (!picked) return;
    try {
      const car = await importCar.mutateAsync(picked);
      close();
      navigate(`/cars/${car.id}`);
    } catch {
      setError('failed');
    }
  };

  return (
    <Modal open={open} onClose={importCar.isPending ? undefined : close} title={t('garage:importTitle')}
      actions={
        <>
          <Button onClick={close} disabled={importCar.isPending}>{t('common:cancel')}</Button>
          <Button variant="contained" onClick={() => void doImport()}
            disabled={!picked || importCar.isPending}>
            {t('garage:importAction')}
          </Button>
        </>
      }>
      <Stack spacing={2} sx={{ pt: 0.5 }}>
        {error ? (
          <Alert severity={error === 'failed' ? 'error' : 'warning'}>
            {t(`garage:import${error === 'badFile' ? 'BadFile' : error === 'newerVersion' ? 'NewerVersion' : error === 'corrupt' ? 'Corrupt' : 'Failed'}`)}
          </Alert>
        ) : null}
        <input ref={inputRef} type="file" accept="application/json,.json" hidden
          onChange={(e) => { void onPick(e.target.files); e.target.value = ''; }} />
        <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />}
          onClick={() => inputRef.current?.click()} disabled={importCar.isPending}>
          {t('garage:importPick')}
        </Button>
        {picked ? (
          <Stack spacing={0.5}>
            <Typography sx={{ fontWeight: 600 }}>
              {t('garage:importPreview', {
                make: picked.car.make, model: picked.car.model,
                events: picked.events.length, reminders: picked.reminders.length,
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('garage:importExportedAt', { date: formatDate(picked.exportedAt, i18n.language) })}
            </Typography>
          </Stack>
        ) : null}
      </Stack>
    </Modal>
  );
}
