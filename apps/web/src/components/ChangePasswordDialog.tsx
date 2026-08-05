import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Snackbar, Stack } from '@mui/material';
import { updatePassword } from 'aws-amplify/auth';
import { Modal } from './ui/Modal';
import { PasswordField } from './ui/PasswordField';
import { PasswordChecklist } from './ui/PasswordChecklist';
import { checkPassword } from '../lib/password-policy';
import { authErrorKey } from '../auth/auth-error';

type Props = { open: boolean; onClose: () => void };

// In THIS dialog a NotAuthorizedException means the current password was wrong —
// map it to the specific message before falling back to the shared table.
function changePasswordErrorKey(err: unknown): string {
  const name = typeof err === 'object' && err !== null && 'name' in err
    ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAuthorizedException') return 'auth:errors.wrongCurrentPassword';
  return authErrorKey(err);
}

// Self-service password change via Amplify on the user's own session. No backend,
// no admin API. Cognito does not revoke tokens on this call, so the session stays valid.
export function ChangePasswordDialog({ open, onClose }: Props) {
  const { t } = useTranslation(['auth', 'common']);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSave = !busy && current !== '' && checkPassword(next).allMet;

  const reset = () => { setCurrent(''); setNext(''); setErrorKey(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await updatePassword({ oldPassword: current, newPassword: next });
      setDone(true);
      close();
    } catch (err) {
      setErrorKey(changePasswordErrorKey(err));
      // Keep the (valid) new password; the wrong current password is what needs retyping.
      setCurrent('');
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open} onClose={busy ? undefined : close} title={t('auth:changePassword')}
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        actions={<Button type="submit" variant="contained" disabled={!canSave}>{t('common:save')}</Button>}
      >
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {errorKey ? <Alert severity="error">{t(errorKey)}</Alert> : null}
          <PasswordField label={t('auth:currentPassword')} value={current}
            onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" fullWidth />
          <PasswordField label={t('auth:newPassword')} value={next}
            onChange={(e) => setNext(e.target.value)} autoComplete="new-password" fullWidth />
          <PasswordChecklist password={next} />
        </Stack>
      </Modal>
      <Snackbar open={done} autoHideDuration={4000} onClose={() => setDone(false)}
        message={t('auth:passwordChanged')} />
    </>
  );
}