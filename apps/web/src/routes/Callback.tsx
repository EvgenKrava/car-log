import { useEffect } from 'react';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';

export function Callback() {
  const auth = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated) navigate('/', { replace: true });
  }, [auth.isLoading, auth.isAuthenticated, navigate]);
  return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
}
