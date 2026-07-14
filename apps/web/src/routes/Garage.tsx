import { useState } from 'react';
import { useAuth } from '../auth';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Container, Fab, Grid } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useCars } from '../queries';
import { CarFormDialog } from '../components/CarFormDialog';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusView } from '../components/ui/StatusView';
import { VehicleCard } from '../components/ui/VehicleCard';

export function Garage() {
  const { t } = useTranslation(['garage', 'common']);
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { data: cars, isLoading, isError } = useCars();
  const [open, setOpen] = useState(false);

  return (
    <AppShell>
      <PageHeader
        title={t('common:appName')}
        actions={<Button color="inherit" onClick={() => void signOut()}>{t('common:signOut')}</Button>}
      />
      <Container sx={{ py: 3 }}>
        {isLoading ? (
          <StatusView state="loading" />
        ) : isError ? (
          <StatusView state="error" message={t('garage:loadError')} />
        ) : !cars?.length ? (
          <EmptyState
            title={t('garage:empty')}
            description={t('garage:emptyHint')}
            action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>{t('garage:addCar')}</Button>}
          />
        ) : (
          <Grid container spacing={2}>
            {cars.map((car) => (
              <Grid item xs={12} sm={6} md={4} key={car.id}>
                <VehicleCard car={car} onClick={() => navigate(`/cars/${car.id}`)} />
              </Grid>
            ))}
          </Grid>
        )}
      </Container>
      <Fab color="primary" onClick={() => setOpen(true)} aria-label="Add car"
        sx={{ position: 'fixed', bottom: 24, right: 24 }}>
        <AddIcon />
      </Fab>
      <CarFormDialog open={open} onClose={() => setOpen(false)} mode="create" />
    </AppShell>
  );
}
