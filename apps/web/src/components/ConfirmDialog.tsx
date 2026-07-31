import { Button, DialogContentText } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Modal } from './ui/Modal';

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
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="xs"
      actions={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button onClick={onConfirm} color="error" variant="contained" disabled={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <DialogContentText>{message}</DialogContentText>
    </Modal>
  );
}