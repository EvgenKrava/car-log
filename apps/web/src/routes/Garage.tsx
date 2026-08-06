import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Container, Fab, Grid, IconButton, Stack } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { useCars } from '../queries';
import { CarFormDialog } from '../components/CarFormDialog';
import { ImportCarDialog } from '../components/ImportCarDialog';
import { GarageAttention } from '../components/GarageAttention';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusView } from '../components/ui/StatusView';
import { VehicleCard } from '../components/ui/VehicleCard';
import { Reveal } from '../components/ui/Reveal';
import { tokens } from '../theme/tokens';

export function Garage() {
  const { t } = useTranslation(['garage', 'common']);
  const navigate = useNavigate();
  const { data: cars, isLoading, isError } = useCars();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <AppShell>
      <PageHeader
        title={t('common:appName')}
        actions={
          <IconButton onClick={() => setImportOpen(true)} aria-label={t('garage:importCar')} color="inherit">
            <UploadFileOutlinedIcon />
          </IconButton>
        }
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
            action={
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>{t('garage:addCar')}</Button>
                <Button variant="text" startIcon={<UploadFileOutlinedIcon />} onClick={() => setImportOpen(true)}>{t('garage:importCar')}</Button>
              </Stack>
            }
          />
        ) : (
          <>
            <GarageAttention cars={cars} />
            <Grid container spacing={2}>
              {cars.map((car, i) => (
                <Grid item xs={12} sm={6} md={4} key={car.id}>
                  <Reveal index={i} sx={{ height: '100%' }}>
                    <VehicleCard car={car} onClick={() => navigate(`/cars/${car.id}`)} />
                  </Reveal>
                </Grid>
              ))}
            </Grid>
          </>
        )}
      </Container>
      <Fab color="primary" onClick={() => setOpen(true)} aria-label={t('garage:addCar')}
        sx={{ position: 'fixed', bottom: 24, right: 24,
          '@keyframes carlogFabIn': {
            from: { opacity: 0, transform: 'scale(0.8)' },
            to: { opacity: 1, transform: 'scale(1)' },
          },
          animation: `carlogFabIn ${tokens.motion.duration.base}ms ${tokens.motion.easing.standard}`,
          transition: `transform ${tokens.motion.duration.fast}ms ${tokens.motion.easing.standard}`,
          '&:active': { transform: 'scale(0.96)' } }}>
        <AddIcon />
      </Fab>
      <CarFormDialog open={open} onClose={() => setOpen(false)} mode="create" />
      <ImportCarDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </AppShell>
  );
}
