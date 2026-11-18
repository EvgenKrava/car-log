import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '.';
import { GARAGE_PATH } from '../lib/paths';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, isAdmin, ready } = useAuth();
  if (status === 'loading' || (status === 'authenticated' && isAdmin && !ready)) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
  }
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to={GARAGE_PATH} replace />;
  return <>{children}</>;
}