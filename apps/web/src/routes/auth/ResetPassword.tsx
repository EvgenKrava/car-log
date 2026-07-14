import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth';
import { authErrorKey } from '../../auth/auth-error';
import { AuthLayout } from './AuthLayout';

export function ResetPassword() {
  const { t } = useTranslation(['auth']);
  const { confirmForgotPassword } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await confirmForgotPassword(email, code, password); navigate('/login', { replace: true }); }
    catch (err) { setError(t(authErrorKey(err))); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title={t('auth:resetTitle')}>
      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('auth:code')} value={code} onChange={(e) => setCode(e.target.value)} fullWidth />
          <TextField label={t('auth:password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth autoComplete="new-password" />
          <Button type="submit" variant="contained" disabled={busy}>{t('auth:resetAction')}</Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
