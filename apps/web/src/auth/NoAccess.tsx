import { Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '.';
import { AuthLayout } from '../routes/auth/AuthLayout';

// Signed in with an Only Tools account that does not have CarLog yet.
export function NoAccess() {
  const { t } = useTranslation(['auth']);
  const { email, signOut } = useAuth();
  return (
    <AuthLayout title={t('auth:noAccessTitle')}>
      <Stack spacing={2}>
        <Typography>{t('auth:noAccessBody', { email: email ?? '' })}</Typography>
        <Button variant="contained" href="https://onlytools.click">{t('auth:toOnlyTools')}</Button>
        <Button onClick={() => void signOut()}>{t('auth:switchAccount')}</Button>
      </Stack>
    </AuthLayout>
  );
}
