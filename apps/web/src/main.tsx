import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useMediaQuery, CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth';
import { buildTheme } from './theme';
import { Garage } from './routes/Garage';
import { Vehicle } from './routes/Vehicle';
import { Login } from './routes/auth/Login';
import { SignUp } from './routes/auth/SignUp';
import { ConfirmSignUp } from './routes/auth/ConfirmSignUp';
import { ForgotPassword } from './routes/auth/ForgotPassword';
import { ResetPassword } from './routes/auth/ResetPassword';
import { Callback } from './routes/Callback';
import { InstallPrompt } from './components/InstallPrompt';

const queryClient = new QueryClient();

function Root() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  return (
    <ThemeProvider theme={buildTheme(prefersDark ? 'dark' : 'light')}>
      <CssBaseline />
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<SignUp />} />
              <Route path="/confirm" element={<ConfirmSignUp />} />
              <Route path="/forgot" element={<ForgotPassword />} />
              <Route path="/reset" element={<ResetPassword />} />
              <Route path="/callback" element={<Callback />} />
              <Route path="/" element={<RequireAuth><Garage /></RequireAuth>} />
              <Route path="/cars/:id" element={<RequireAuth><Vehicle /></RequireAuth>} />
            </Routes>
            <InstallPrompt />
          </BrowserRouter>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
