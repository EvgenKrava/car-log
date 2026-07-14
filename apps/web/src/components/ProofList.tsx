import { useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, IconButton, Link, Stack, Typography } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useTranslation } from 'react-i18next';
import { useProofs, useUploadProof, useDeleteProof } from '../queries';
import { validateAttachmentFile } from '../lib/validate-attachment';
import { ConfirmDialog } from './ConfirmDialog';

export function ProofList({ carId, eventId }: { carId: string; eventId: string }) {
  const { t } = useTranslation(['event', 'common']);
  const { data: proofs } = useProofs(carId, eventId);
  const upload = useUploadProof(carId, eventId);
  const del = useDeleteProof(carId, eventId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const v = validateAttachmentFile({ type: file.type, size: file.size }, proofs?.length ?? 0);
    if (v) { setError(t(v.key, v.params)); return; }
    setError(null);
    try { await upload.mutateAsync(file); } catch { setError(t('event:proofUploadFailed')); }
  };

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle2">{t('event:proofs')}</Typography>
        <Button size="small" startIcon={<AttachFileIcon />} onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {t('event:addProof')}
        </Button>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" hidden onChange={onPick} />
      </Stack>
      {error ? <Alert severity="error" sx={{ my: 1 }}>{error}</Alert> : null}
      {!proofs?.length ? (
        <Typography variant="body2" color="text.secondary">{t('event:noProofs')}</Typography>
      ) : (
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
          {proofs.map((p) => (
            <Box key={p.id} sx={{ position: 'relative' }}>
              {p.contentType === 'application/pdf' ? (
                <Link href={p.url} target="_blank" rel="noopener" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 1, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                  <PictureAsPdfIcon color="error" /> <Typography variant="body2" noWrap sx={{ maxWidth: 140 }}>{p.filename ?? t('event:openPdf')}</Typography>
                </Link>
              ) : (
                <img src={p.url} alt="proof" loading="lazy" onClick={() => setLightbox(p.url)}
                  style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, cursor: 'pointer' }} />
              )}
              <IconButton size="small" aria-label="delete proof" onClick={() => setToDelete(p.id)}
                sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'background.paper', boxShadow: 1 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Stack>
      )}
      <Dialog open={Boolean(lightbox)} onClose={() => setLightbox(null)} maxWidth="md">
        {lightbox ? <img src={lightbox} alt="proof" style={{ width: '100%', display: 'block' }} /> : null}
      </Dialog>
      <ConfirmDialog open={Boolean(toDelete)} title={t('event:proofDeleteTitle')} message={t('event:proofDeleteConfirm')}
        confirmLabel={t('common:delete')} loading={del.isPending}
        onConfirm={async () => { if (toDelete) await del.mutateAsync(toDelete); setToDelete(null); }}
        onClose={() => setToDelete(null)} />
    </Box>
  );
}
