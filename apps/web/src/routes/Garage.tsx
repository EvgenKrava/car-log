import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
import {
  AppBar, Box, Button, Card, CardContent, CircularProgress, Container, Fab, Grid,
  Toolbar, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useCars } from '../queries';
import { CarFormDialog } from '../components/CarFormDialog';

export function Garage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { data: cars, isLoading } = useCars();
  const [open, setOpen] = useState(false);

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>CarLog</Typography>
          <Button color="inherit" onClick={() => void auth.signoutRedirect()}>Sign out</Button>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 3 }}>
        {isLoading ? <CircularProgress /> : !cars?.length ? (
          <Typography color="text.secondary">Add your first car.</Typography>
        ) : (
          <Grid container spacing={2}>
            {cars.map((car) => {
              const displayName: string = car.nickname || `${car.make} ${car.model}`;
              const details: string = `${car.year} · ${car.mileage.toLocaleString()} mi`;
              return (
                <Grid item xs={12} sm={6} md={4} key={car.id}>
                  <Card onClick={() => navigate(`/cars/${car.id}`)} sx={{ cursor: 'pointer' }}>
                    <CardContent>
                      <Typography variant="h6">{displayName}</Typography>
                      <Typography color="text.secondary">{details}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Container>
      <Fab color="primary" onClick={() => setOpen(true)} sx={{ position: 'fixed', bottom: 24, right: 24 }}>
        <AddIcon />
      </Fab>
      <CarFormDialog open={open} onClose={() => setOpen(false)} mode="create" />
      <Box sx={{ height: 80 }} />
    </>
  );
}
