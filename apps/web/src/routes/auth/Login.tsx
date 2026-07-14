import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth';
import { authErrorKey } from '../../auth/auth-error';
import { AuthLayout } from './AuthLayout';

export function Login() {
  const { t } = useTranslation(['auth']);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await signIn(email, password); navigate('/', { replace: true }); }
    catch (err) { setError(t(authErrorKey(err))); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title={t('auth:signInTitle')}>
      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('auth:email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth autoComplete="email" />
          <TextField label={t('auth:password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth autoComplete="current-password" />
          <Button type="submit" variant="contained" disabled={busy}>{t('auth:signInAction')}</Button>
          <Link component={RouterLink} to="/forgot">{t('auth:toForgot')}</Link>
          <Link component={RouterLink} to="/signup">{t('auth:toSignUp')}</Link>
        </Stack>
      </form>
    </AuthLayout>
  );
}
