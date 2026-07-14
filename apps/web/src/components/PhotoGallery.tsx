import { useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, IconButton, ImageList, ImageListItem, Stack, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DeleteIcon from '@mui/icons-material/Delete';
import { usePhotos, useUploadPhoto, useDeletePhoto } from '../queries';
import { validatePhotoFile } from '../lib/validate-photo';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusView } from './ui/StatusView';

export function PhotoGallery({ carId }: { carId: string }) {
  const { t } = useTranslation(['photos', 'common']);
  const { data: photos, isLoading, isError } = usePhotos(carId);
  const upload = useUploadPhoto(carId);
  const del = useDeletePhoto(carId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const v = validatePhotoFile({ type: file.type, size: file.size }, photos?.length ?? 0);
    if (v) { setError(t(v.key, v.params)); return; }
    setError(null);
    try { await upload.mutateAsync(file); } catch { setError(t('photos:uploadFailed')); }
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">{t('photos:title')}</Typography>
        <Button startIcon={<AddPhotoAlternateIcon />} onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {t('photos:add')}
        </Button>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      </Stack>
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {upload.isPending ? <Box sx={{ mb: 2 }}><CircularProgress size={20} /></Box> : null}

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
