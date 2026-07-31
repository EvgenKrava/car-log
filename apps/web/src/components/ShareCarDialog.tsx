import { useState } from 'react';
import {
  Box, Button, FormControlLabel, IconButton, InputAdornment, Stack, Switch, TextField, Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import IosShareIcon from '@mui/icons-material/IosShare';
import { useTranslation } from 'react-i18next';
import type { Car } from '@carlog/contracts';
import { useSetCarSharing } from '../queries';
import { Modal } from './ui/Modal';

type ShareCarDialogProps = {
  open: boolean;
  onClose: () => void;
  car: Car;
};

// Owner-facing "Public link" dialog: a Switch flips the car's `shared` flag; once
// shared, a read-only link appears with Copy + native-share affordances. The link
// itself is stable (derived from the car id), so there's nothing to fetch here.
export function ShareCarDialog({ open, onClose, car }: ShareCarDialogProps) {
  const { t } = useTranslation(['share', 'common']);
  const setSharing = useSetCarSharing();
  const [copied, setCopied] = useState(false);

  const link = `${window.location.origin}/s/${car.id}`;

  const onToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSharing.mutate({ carId: car.id, shared: e.target.checked });
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied — no-op */
    }
  };

  const onShare = async () => {
    try {
      if (navigator.share) await navigator.share({ url: link, title: t('share:menu') });
      else await onCopy();
    } catch {
      /* user dismissed the share sheet — no-op */
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('share:menu')}
      maxWidth="xs"
      actions={<Button onClick={onClose}>{t('common:cancel')}</Button>}
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <FormControlLabel
          control={<Switch checked={car.shared} onChange={onToggle} disabled={setSharing.isPending} />}
          label={t('share:toggle')}
        />
        <Typography variant="body2" color="text.secondary">
          {t('share:hint')}
        </Typography>
        {car.shared ? (
          <Box>
            <TextField
              value={link}
              fullWidth
              size="small"
              InputProps={{
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton aria-label={t('share:copy')} onClick={() => void onCopy()} edge="end">
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              onFocus={(e) => e.target.select()}
            />
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
              <Button variant="outlined" startIcon={<IosShareIcon />} onClick={() => void onShare()}>
                {t('common:share')}
              </Button>
              {copied ? (
                <Typography variant="caption" color="success.main">
                  {t('share:copied')}
                </Typography>
              ) : null}
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </Modal>
  );
}