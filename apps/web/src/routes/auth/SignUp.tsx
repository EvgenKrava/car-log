import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Alert, Button, Divider, Link, Stack, TextField, Typography, Box } from '@mui/material';
import { CheckCircle, Circle } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth';
import { authErrorKey } from '../../auth/auth-error';
import { AuthLayout } from './AuthLayout';
import { PasswordField } from '../../components/ui/PasswordField';
import { GoogleSignInButton } from '../../components/ui/GoogleSignInButton';
import { checkPassword } from '../../lib/password-policy';

export function SignUp() {
  const { t } = useTranslation(['auth']);
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pwCheck = checkPassword(password);
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
          {password && (
            <Box sx={{ pl: 1 }}>
              <Typography variant="caption" color="text.secondary">{t('auth:pwRequirements')}</Typography>
              <Box component="ul" sx={{ m: 0, pl: 3, fontSize: '0.75rem', color: 'text.secondary' }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {pwCheck.minLength ? <CheckCircle fontSize="inherit" color="success" /> : <Circle fontSize="inherit" />}
                  <span>{t('auth:pwMinLength')}</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {pwCheck.upper ? <CheckCircle fontSize="inherit" color="success" /> : <Circle fontSize="inherit" />}
                  <span>{t('auth:pwUpper')}</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {pwCheck.lower ? <CheckCircle fontSize="inherit" color="success" /> : <Circle fontSize="inherit" />}
                  <span>{t('auth:pwLower')}</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {pwCheck.number ? <CheckCircle fontSize="inherit" color="success" /> : <Circle fontSize="inherit" />}
                  <span>{t('auth:pwNumber')}</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {pwCheck.symbol ? <CheckCircle fontSize="inherit" color="success" /> : <Circle fontSize="inherit" />}
                  <span>{t('auth:pwSymbol')}</span>
                </li>
              </Box>
            </Box>
          )}
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
