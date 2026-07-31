import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQueryClient } from '@tanstack/react-query';
import { MAX_PHOTOS_PER_CAR } from '@carlog/contracts';
import { usePhotos, useUploadPhoto, useDeletePhoto } from '../queries';
import { validatePhotoFile } from '../lib/validate-photo';
import { useBatchUpload } from '../lib/use-batch-upload';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './ui/Modal';
import { StatusView } from './ui/StatusView';
import { BatchUploadStatus } from './ui/BatchUploadStatus';

export function PhotoGallery({ carId }: { carId: string }) {
  const { t } = useTranslation(['photos', 'common']);
  const { data: photos, isLoading, isError } = usePhotos(carId);
  const upload = useUploadPhoto(carId);
  const del = useDeletePhoto(carId);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);

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

  const count = photos?.length ?? 0;
  const step = useCallback((delta: number) => {
    setLightboxIndex((i) => (i === null || count === 0 ? i : (i + delta + count) % count));
  }, [count]);

  // Arrow-key navigation while the lightbox is open.
  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, step]);

  const current = lightboxIndex !== null ? photos?.[lightboxIndex] : undefined;

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
        // Horizontal snap carousel — swipes naturally on mobile, scrolls on desktop.
        <Box
          sx={{
            display: 'flex', gap: 1, overflowX: 'auto', pb: 1,
            scrollSnapType: 'x mandatory',
            '&::-webkit-scrollbar': { height: 6 },
            '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 3 },
          }}
        >
          {photos.map((p, i) => (
            <Box
              key={p.id}
              sx={{
                position: 'relative', flex: '0 0 auto', borderRadius: 2, overflow: 'hidden',
                scrollSnapAlign: 'start',
                width: { xs: '72%', sm: 240 }, aspectRatio: '4 / 3',
              }}
            >
              <img
                src={p.url} alt="Car photo" loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', display: 'block' }}
                onClick={() => setLightboxIndex(i)}
              />
              <IconButton
                size="small" aria-label="Delete photo"
                onClick={() => setToDelete(p.id)}
                sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(0,0,0,0.5)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      <Modal open={lightboxIndex !== null} onClose={() => setLightboxIndex(null)} maxWidth="md" plain contentSx={{ p: 0 }}>
        {current ? (
          <Box
            sx={{ position: 'relative', bgcolor: 'black' }}
            onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
            onTouchEnd={(e) => {
              const start = touchStartX.current;
              touchStartX.current = null;
              const end = e.changedTouches[0]?.clientX;
              if (start === null || end === undefined) return;
              const dx = end - start;
              if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1); // swipe left → next
            }}
          >
            <img src={current.url} alt="Car photo" style={{ width: '100%', display: 'block' }} />
            {count > 1 ? (
              <>
                <IconButton
                  aria-label={t('photos:prev')}
                  onClick={() => step(-1)}
                  sx={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', bgcolor: 'rgba(0,0,0,0.45)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.65)' } }}
                >
                  <ChevronLeftIcon />
                </IconButton>
                <IconButton
                  aria-label={t('photos:next')}
                  onClick={() => step(1)}
                  sx={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', bgcolor: 'rgba(0,0,0,0.45)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.65)' } }}
                >
                  <ChevronRightIcon />
                </IconButton>
                <Typography
                  variant="caption"
                  sx={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', color: '#fff', bgcolor: 'rgba(0,0,0,0.45)', px: 1, borderRadius: 1 }}
                >
                  {(lightboxIndex ?? 0) + 1} / {count}
                </Typography>
              </>
            ) : null}
          </Box>
        ) : null}
      </Modal>

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