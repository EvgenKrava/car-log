import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useBottomSheetDismiss } from './ui/useBottomSheetDismiss';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
};

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Delete', onConfirm, onClose, loading = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation(['common']);
  const sheet = useBottomSheetDismiss(onClose);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" {...sheet}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:cancel')}</Button>
        <Button onClick={onConfirm} color="error" variant="contained" disabled={loading}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
