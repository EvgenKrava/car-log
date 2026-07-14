import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, CardContent, Chip, Container, Stack, Typography } from '@mui/material';
import type { Car } from '@carlog/contracts';
import { useCar, useDeleteCar } from '../queries';
import { CarFormDialog } from '../components/CarFormDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImportEventsDialog } from '../components/ImportEventsDialog';
import { PhotoGallery } from '../components/PhotoGallery';
import { ServiceTimeline } from '../components/ServiceTimeline';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusView } from '../components/ui/StatusView';
import { formatNumber } from '../i18n/format';

function SpecRow({ label, value }: { label: string; value: string | number }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ fontWeight: 500 }}>{value}</Typography>
    </Stack>
  );
}

function VehicleDetail({ car }: { car: Car }) {
  const { t, i18n } = useTranslation(['vehicle', 'car', 'common', 'import']);
  const navigate = useNavigate();
  const del = useDeleteCar();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const title = car.nickname || `${car.make} ${car.model}`;
  const onDelete = async () => { await del.mutateAsync(car.id); navigate('/', { replace: true }); };

  return (
    <AppShell>
      <PageHeader
        title={title}
        onBack={() => navigate('/')}
        actions={
          <>
            <Button variant="contained" onClick={() => setEditOpen(true)}>{t('common:edit')}</Button>
            <Button color="error" onClick={() => setConfirmOpen(true)}>{t('common:delete')}</Button>
          </>
        }
      />
      <Container sx={{ py: 3 }}>
        <Card>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6">{car.make} {car.model}</Typography>
              <Chip label={t(`car:fuelType_${car.fuelType}`)} color="primary" variant="outlined" />
            </Stack>
            <SpecRow label={t('car:year')} value={car.year} />
            <SpecRow label={t('car:mileage')} value={`${formatNumber(car.mileage, i18n.language)} ${t('vehicle:mileageUnit')}`} />
            {car.nickname ? <SpecRow label={t('car:nickname')} value={car.nickname} /> : null}
            {car.vin ? <SpecRow label={t('car:vin')} value={car.vin} /> : null}
            {car.licensePlate ? <SpecRow label={t('car:licensePlate')} value={car.licensePlate} /> : null}
          </CardContent>
        </Card>
        <PhotoGallery carId={car.id} />
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
          <Button variant="outlined" onClick={() => setImportOpen(true)}>{t('import:trigger')}</Button>
        </Stack>
        <ServiceTimeline carId={car.id} />
        {del.isError ? <Alert severity="error" sx={{ mt: 2 }}>{t('vehicle:deleteFailed')}</Alert> : null}
      </Container>
      <CarFormDialog open={editOpen} onClose={() => setEditOpen(false)} mode="edit" car={car} />
      <ConfirmDialog
        open={confirmOpen}
        title={t('car:deleteTitle')}
        message={t('car:deleteConfirm')}
        onConfirm={onDelete}
        onClose={() => setConfirmOpen(false)}
        loading={del.isPending}
      />
      <ImportEventsDialog carId={car.id} open={importOpen} onClose={() => setImportOpen(false)} />
    </AppShell>
  );
}

export function Vehicle() {
  const { t } = useTranslation(['vehicle', 'common']);
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: car, isLoading, isError } = useCar(id);

  if (isLoading) return <AppShell><StatusView state="loading" /></AppShell>;
  if (isError || !car) {
    return (
      <AppShell>
        <Container sx={{ py: 8, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>{t('vehicle:notFound')}</Typography>
          <Button variant="contained" onClick={() => navigate('/')}>{t('vehicle:backToGarage')}</Button>
        </Container>
      </AppShell>
    );
  }
  return <VehicleDetail car={car} />;
}
