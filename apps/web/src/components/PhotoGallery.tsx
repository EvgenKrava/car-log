import { useRef, useState } from 'react';
import {
  Box, Button, Dialog, IconButton, ImageList, ImageListItem, Stack, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQueryClient } from '@tanstack/react-query';
import { MAX_PHOTOS_PER_CAR } from '@carlog/contracts';
import { usePhotos, useUploadPhoto, useDeletePhoto } from '../queries';
import { validatePhotoFile } from '../lib/validate-photo';
import { useBatchUpload } from '../lib/use-batch-upload';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusView } from './ui/StatusView';
import { BatchUploadStatus } from './ui/BatchUploadStatus';

export function PhotoGallery({ carId }: { carId: string }) {
  const { t } = useTranslation(['photos', 'common']);
  const { data: photos, isLoading, isError } = usePhotos(carId);
  const upload = useUploadPhoto(carId);
  const del = useDeletePhoto(carId);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const batch = useBatchUpload({
    upload: (file) => upload.mutateAsync(file).then(() => undefined),
    validateOne: validatePhotoFile,
    remaining: () => MAX_PHOTOS_PER_CAR - (photos?.length ?? 0),
    onComplete: () => { void qc.invalidateQueries({ queryKey: ['cars', carId, 'photos'] }); },
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    batch.start(files);
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">{t('photos:title')}</Typography>
        <Button startIcon={<AddPhotoAlternateIcon />} onClick={() => inputRef.current?.click()} disabled={batch.running}>
          {t('photos:add')}
        </Button>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onPick} />
      </Stack>
      <BatchUploadStatus items={batch.items} running={batch.running} />

      {isLoading ? (
        <StatusView state="loading" />
      ) : isError ? (
        <StatusView state="error" message={t('photos:loadError')} />
      ) : !photos?.length ? (
        <Typography color="text.secondary">{t('photos:empty')}</Typography>
      ) : (
        <ImageList cols={3} gap={8} sx={{ m: 0 }}>
          {photos.map((p) => (
            <ImageListItem key={p.id} sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden' }}>
              <img
                src={p.url} alt="Car photo" loading="lazy"
                style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', cursor: 'pointer' }}
                onClick={() => setLightbox(p.url)}
              />
              <IconButton
                size="small" aria-label="Delete photo"
                onClick={() => setToDelete(p.id)}
                sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(0,0,0,0.5)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </ImageListItem>
          ))}
        </ImageList>
      )}

      <Dialog open={Boolean(lightbox)} onClose={() => setLightbox(null)} maxWidth="md">
        {lightbox ? <img src={lightbox} alt="Car photo" style={{ width: '100%', display: 'block' }} /> : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={t('photos:deleteTitle')}
        message={t('photos:deleteConfirm')}
        confirmLabel={t('common:delete')}
        onConfirm={async () => { if (toDelete) await del.mutateAsync(toDelete); setToDelete(null); }}
        onClose={() => setToDelete(null)}
        loading={del.isPending}
      />
    </Box>
  );
}
