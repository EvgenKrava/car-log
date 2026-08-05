import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Alert, Button, Divider, Link, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth';
import { authErrorKey } from '../../auth/auth-error';
import { AuthLayout } from './AuthLayout';
import { PasswordField } from '../../components/ui/PasswordField';
import { PasswordChecklist } from '../../components/ui/PasswordChecklist';
import { GoogleSignInButton } from '../../components/ui/GoogleSignInButton';

export function SignUp() {
  const { t } = useTranslation(['auth']);
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm !== '' && password !== confirm;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError(t('auth:errors.passwordMismatch')); return; }
    setBusy(true); setError(null);
    try { await signUp(email, password); navigate(`/confirm?email=${encodeURIComponent(email)}`); }
    catch (err) { setError(t(authErrorKey(err))); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title={t('auth:signUpTitle')}>
      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          <GoogleSignInButton />
          <Divider>{t('auth:orDivider')}</Divider>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('auth:email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth autoComplete="email" />
          <PasswordField label={t('auth:password')} value={password} onChange={(e) => setPassword(e.target.value)} fullWidth autoComplete="new-password" />
          {password && <PasswordChecklist password={password} />}
          <PasswordField
            label={t('auth:confirmPassword')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            fullWidth
            autoComplete="new-password"
            error={mismatch}
            helperText={mismatch ? t('auth:errors.passwordMismatch') : undefined}
          />
          <Button type="submit" variant="contained" disabled={busy}>{t('auth:signUpAction')}</Button>
          <Link component={RouterLink} to="/login">{t('auth:toSignIn')}</Link>
        </Stack>
      </form>
    </AuthLayout>
  );
}
