import { createTheme } from '@mui/material/styles';
export const buildTheme = (mode: 'light' | 'dark') =>
  createTheme({ palette: { mode, primary: { main: '#1565c0' } } });
