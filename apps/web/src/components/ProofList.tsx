import { useRef, useState } from 'react';
import { Box, Button, Dialog, IconButton, Link, Stack, Typography } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { MAX_PROOFS_PER_EVENT } from '@carlog/contracts';
import { useProofs, useUploadProof, useDeleteProof } from '../queries';
import { validateAttachmentFile } from '../lib/validate-attachment';
import { useBatchUpload } from '../lib/use-batch-upload';
import { ConfirmDialog } from './ConfirmDialog';
import { BatchUploadStatus } from './ui/BatchUploadStatus';

export function ProofList({ carId, eventId }: { carId: string; eventId: string }) {
  const { t } = useTranslation(['event', 'common']);
  const { data: proofs } = useProofs(carId, eventId);
  const upload = useUploadProof(carId, eventId);
  const del = useDeleteProof(carId, eventId);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const batch = useBatchUpload({
    upload: (file) => upload.mutateAsync(file).then(() => undefined),
    validateOne: validateAttachmentFile,
    remaining: () => MAX_PROOFS_PER_EVENT - (proofs?.length ?? 0),
    onComplete: () => { void qc.invalidateQueries({ queryKey: ['cars', carId, 'events', eventId, 'proofs'] }); },
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    batch.start(files);
  };

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle2">{t('event:proofs')}</Typography>
        <Button size="small" startIcon={<AttachFileIcon />} onClick={() => inputRef.current?.click()} disabled={batch.running}>
          {t('event:addProof')}
        </Button>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={onPick} />
      </Stack>
      <BatchUploadStatus items={batch.items} running={batch.running} />
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
