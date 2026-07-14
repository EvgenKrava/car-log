import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useMediaQuery, CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppAuthProvider, RequireAuth } from './auth';
import { buildTheme } from './theme';
import { Garage } from './routes/Garage';
import { Callback } from './routes/Callback';
import { Vehicle } from './routes/Vehicle';

const queryClient = new QueryClient();

function Root() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  return (
    <ThemeProvider theme={buildTheme(prefersDark ? 'dark' : 'light')}>
      <CssBaseline />
      <AppAuthProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/callback" element={<Callback />} />
              <Route path="/" element={<RequireAuth><Garage /></RequireAuth>} />
              <Route path="/cars/:id" element={<RequireAuth><Vehicle /></RequireAuth>} />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AppAuthProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
