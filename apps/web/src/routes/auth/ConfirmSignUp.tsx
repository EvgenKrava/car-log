import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth';
import { authErrorKey } from '../../auth/auth-error';
import { AuthLayout } from './AuthLayout';

export function ConfirmSignUp() {
  const { t } = useTranslation(['auth']);
  const { confirmSignUp, resendCode } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await confirmSignUp(email, code); navigate('/login', { replace: true }); }
    catch (err) { setError(t(authErrorKey(err))); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title={t('auth:confirmTitle')}>
      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          <Alert severity="info">{t('auth:checkEmail')}</Alert>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('auth:code')} value={code} onChange={(e) => setCode(e.target.value)} fullWidth />
          <Button type="submit" variant="contained" disabled={busy}>{t('auth:confirmAction')}</Button>
          <Button onClick={() => void resendCode(email)} disabled={!email}>{t('auth:resendCode')}</Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
