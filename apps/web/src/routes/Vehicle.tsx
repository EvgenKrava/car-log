import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AppBar, Box, Button, CircularProgress, Container, IconButton, Stack, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { Car } from '@carlog/contracts';
import { useCar, useDeleteCar } from '../queries';
import { CarFormDialog } from '../components/CarFormDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography>{value}</Typography>
    </Stack>
  );
}

function VehicleDetail({ car }: { car: Car }) {
  const navigate = useNavigate();
  const del = useDeleteCar();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const title: string = car.nickname || `${car.make} ${car.model}`;

  const onDelete = async () => {
    await del.mutateAsync(car.id);
    navigate('/', { replace: true });
  };

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <IconButton edge="start" color="inherit" onClick={() => navigate('/')} aria-label="Back to garage">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>{title}</Typography>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 3 }}>
        <Stack spacing={0}>
          <DetailRow label="Make" value={car.make} />
          <DetailRow label="Model" value={car.model} />
          <DetailRow label="Year" value={car.year} />
          <DetailRow label="Mileage" value={`${car.mileage.toLocaleString()} mi`} />
          <DetailRow label="Fuel type" value={car.fuelType} />
          {car.nickname ? <DetailRow label="Nickname" value={car.nickname} /> : null}
          {car.vin ? <DetailRow label="VIN" value={car.vin} /> : null}
          {car.licensePlate ? <DetailRow label="License plate" value={car.licensePlate} /> : null}
        </Stack>
        <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
          <Button variant="contained" onClick={() => setEditOpen(true)}>Edit</Button>
          <Button color="error" onClick={() => setConfirmOpen(true)}>Delete</Button>
        </Stack>
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
    </>
  );
}

export function Vehicle() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: car, isLoading, isError } = useCar(id);

  if (isLoading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
  }
  if (isError || !car) {
    return (
      <Container sx={{ py: 6, textAlign: 'center' }}>
        <Typography variant="h6" gutterBottom>Car not found</Typography>
        <Button variant="contained" onClick={() => navigate('/')}>Back to garage</Button>
      </Container>
    );
  }
  return <VehicleDetail car={car} />;
}
