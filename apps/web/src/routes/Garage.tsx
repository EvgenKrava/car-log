import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
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
  const auth = useAuth();
  const navigate = useNavigate();
  const { data: cars, isLoading, isError } = useCars();
  const [open, setOpen] = useState(false);

  return (
    <AppShell>
      <PageHeader
        title="CarLog"
        actions={<Button color="inherit" onClick={() => void auth.signoutRedirect()}>Sign out</Button>}
      />
      <Container sx={{ py: 3 }}>
        {isLoading ? (
          <StatusView state="loading" />
        ) : isError ? (
          <StatusView state="error" message="Could not load your garage." />
        ) : !cars?.length ? (
          <EmptyState
            title="Add your first car"
            description="Start keeping a maintenance history for every vehicle you own."
            action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Add a car</Button>}
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
