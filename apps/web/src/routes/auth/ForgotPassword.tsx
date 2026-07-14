import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth';
import { authErrorKey } from '../../auth/auth-error';
import { AuthLayout } from './AuthLayout';

export function ForgotPassword() {
  const { t } = useTranslation(['auth']);
  const { forgotPassword } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await forgotPassword(email); navigate(`/reset?email=${encodeURIComponent(email)}`); }
    catch (err) { setError(t(authErrorKey(err))); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title={t('auth:forgotTitle')}>
      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('auth:email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth autoComplete="email" />
          <Button type="submit" variant="contained" disabled={busy}>{t('auth:sendCode')}</Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
