import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, CardContent, Chip, Container, Stack, Typography } from '@mui/material';
import type { Car } from '@carlog/contracts';
import { useCar, useDeleteCar } from '../queries';
import { CarFormDialog } from '../components/CarFormDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PhotoGallery } from '../components/PhotoGallery';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusView } from '../components/ui/StatusView';

function SpecRow({ label, value }: { label: string; value: string | number }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ fontWeight: 500 }}>{value}</Typography>
    </Stack>
  );
}

function VehicleDetail({ car }: { car: Car }) {
  const navigate = useNavigate();
  const del = useDeleteCar();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const title = car.nickname || `${car.make} ${car.model}`;
  const onDelete = async () => { await del.mutateAsync(car.id); navigate('/', { replace: true }); };

  return (
    <AppShell>
      <PageHeader
        title={title}
        onBack={() => navigate('/')}
        actions={
          <>
            <Button variant="contained" onClick={() => setEditOpen(true)}>Edit</Button>
            <Button color="error" onClick={() => setConfirmOpen(true)}>Delete</Button>
          </>
        }
      />
      <Container sx={{ py: 3 }}>
        <Card>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6">{car.make} {car.model}</Typography>
              <Chip label={car.fuelType} color="primary" variant="outlined" />
            </Stack>
            <SpecRow label="Year" value={car.year} />
            <SpecRow label="Mileage" value={`${car.mileage.toLocaleString()} mi`} />
            {car.nickname ? <SpecRow label="Nickname" value={car.nickname} /> : null}
            {car.vin ? <SpecRow label="VIN" value={car.vin} /> : null}
            {car.licensePlate ? <SpecRow label="License plate" value={car.licensePlate} /> : null}
          </CardContent>
        </Card>
        <PhotoGallery carId={car.id} />
        {del.isError ? <Alert severity="error" sx={{ mt: 2 }}>Failed to delete. Please try again.</Alert> : null}
      </Container>
      <CarFormDialog open={editOpen} onClose={() => setEditOpen(false)} mode="edit" car={car} />
      <ConfirmDialog
        open={confirmOpen}
        title="Delete car"
        message="Delete this car? This can't be undone."
        onConfirm={onDelete}
        onClose={() => setConfirmOpen(false)}
        loading={del.isPending}
      />
    </AppShell>
  );
}

export function Vehicle() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: car, isLoading, isError } = useCar(id);

  if (isLoading) return <AppShell><StatusView state="loading" /></AppShell>;
  if (isError || !car) {
    return (
      <AppShell>
        <Container sx={{ py: 8, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>Car not found</Typography>
          <Button variant="contained" onClick={() => navigate('/')}>Back to garage</Button>
        </Container>
      </AppShell>
    );
  }
  return <VehicleDetail car={car} />;
}
