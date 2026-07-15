import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, Container, Stack, Typography } from '@mui/material';
import { useAuth } from '../auth';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ fontWeight: 500 }}>{value}</Typography>
    </Stack>
  );
}

export function Profile() {
  const { t } = useTranslation(['common']);
  const { email } = useAuth();
  const navigate = useNavigate();

  return (
    <AppShell>
      <PageHeader title={t('common:profile')} onBack={() => navigate('/')} />
      <Container sx={{ py: 3 }}>
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>{t('common:account')}</Typography>
            <SpecRow label="Email" value={email ?? '—'} />
          </CardContent>
        </Card>
        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Typography color="text.secondary">{t('common:settingsComingSoon')}</Typography>
          </CardContent>
        </Card>
      </Container>
    </AppShell>
  );
}
