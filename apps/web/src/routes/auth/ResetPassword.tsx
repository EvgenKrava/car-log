import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Stack, TextField, Typography, Box } from '@mui/material';
import { CheckCircle, Circle } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth';
import { authErrorKey } from '../../auth/auth-error';
import { AuthLayout } from './AuthLayout';
import { PasswordField } from '../../components/ui/PasswordField';
import { checkPassword } from '../../lib/password-policy';

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

  const pwCheck = checkPassword(password);

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
          <Button type="submit" variant="contained" disabled={busy}>{t('auth:resetAction')}</Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
