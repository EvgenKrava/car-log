import { useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useDeleteAccount } from '../queries';
import { useAuth } from '../auth';

const CONFIRM_WORD = 'DELETE';

// Destructive confirmation: the button only enables once the user types DELETE.
export function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['auth', 'common']);
  const { signOut } = useAuth();
  const del = useDeleteAccount();
  const [typed, setTyped] = useState('');

  const onConfirm = async () => {
    try {
      await del.mutateAsync();
    } catch {
      return; // del.isError renders the alert; keep the dialog open for a retry
    }
    // AuthProvider flips to unauthenticated → RequireAuth redirects to /login.
    await signOut();
  };

  return (
    <Dialog open={open} onClose={del.isPending ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('auth:deleteAccountTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{t('auth:deleteAccountBody')}</DialogContentText>
        {del.isError ? <Alert severity="error" sx={{ mb: 2 }}>{t('auth:deleteAccountFailed')}</Alert> : null}
        <TextField fullWidth autoFocus label={t('auth:deleteAccountConfirmHint')} value={typed}
          onChange={(e) => setTyped(e.target.value)} inputProps={{ autoCapitalize: 'characters' }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={del.isPending}>{t('common:cancel')}</Button>
        <Button color="error" variant="contained" disabled={typed !== CONFIRM_WORD || del.isPending} onClick={() => void onConfirm()}>
          {t('auth:deleteAccount')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
