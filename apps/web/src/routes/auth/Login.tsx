import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth';
import { AuthLayout } from './AuthLayout';
import { GARAGE_PATH } from '../../lib/paths';

// Sign-in is the shared Only Tools account (auth.onlytools.click). The page sends the user
// there straight away; the button is for when that was cancelled or failed (?retry).
export function Login() {
  const { t } = useTranslation(['auth']);
  const { status, signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const retry = new URLSearchParams(window.location.search).has('retry');

  const go = () => { setBusy(true); void signIn().catch(() => setBusy(false)); };

  useEffect(() => {
    if (status === 'unauthenticated' && !retry) go();
  }, [status]);

  if (status === 'authenticated') return <Navigate to={GARAGE_PATH} replace />;

  return (
    <AuthLayout title={t('auth:signInTitle')}>
      <Stack spacing={2}>
        <Typography color="text.secondary">{t('auth:onlyToolsHint')}</Typography>
        <Button variant="contained" onClick={go} disabled={busy}>{t('auth:signInOnlyTools')}</Button>
      </Stack>
    </AuthLayout>
  );
}
