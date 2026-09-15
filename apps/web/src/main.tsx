import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './i18n';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { useMediaQuery, CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth';
import { RequireAdmin } from './auth/RequireAdmin';
import { buildTheme } from './theme';
import { ThemeModeProvider, useThemeMode } from './lib/theme-mode';
import { GARAGE_PATH } from './lib/paths';
import { Garage } from './routes/Garage';
import { Vehicle } from './routes/Vehicle';
import { Login } from './routes/auth/Login';
import { Callback } from './routes/Callback';
import { InstallPrompt } from './components/InstallPrompt';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RouteFallback } from './components/RouteFallback';

// Eager: Login (logged-out entry), Garage + Vehicle (core), Callback (OAuth return).
// Everything else loads on first visit.
const Profile = lazy(() => import('./routes/Profile').then((m) => ({ default: m.Profile })));
const ChatConversation = lazy(() => import('./routes/ChatConversation').then((m) => ({ default: m.ChatConversation })));
const PublicVehicle = lazy(() => import('./routes/PublicVehicle').then((m) => ({ default: m.PublicVehicle })));
const SignUp = lazy(() => import('./routes/auth/SignUp').then((m) => ({ default: m.SignUp })));
const ConfirmSignUp = lazy(() => import('./routes/auth/ConfirmSignUp').then((m) => ({ default: m.ConfirmSignUp })));
const ForgotPassword = lazy(() => import('./routes/auth/ForgotPassword').then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./routes/auth/ResetPassword').then((m) => ({ default: m.ResetPassword })));
const UserManagement = lazy(() => import('./routes/admin/UserManagement').then((m) => ({ default: m.UserManagement })));
const Dashboard = lazy(() => import('./routes/admin/Dashboard').then((m) => ({ default: m.Dashboard })));
const NotFound = lazy(() => import('./routes/NotFound').then((m) => ({ default: m.NotFound })));
import { PushRefresh } from './components/PushRefresh';

const queryClient = new QueryClient();

function Root() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  // User preference (Profile → Settings) wins; "system" follows the OS.
  const { mode } = useThemeMode();
  const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  return (
    <ThemeProvider theme={buildTheme(resolved)}>
      <CssBaseline />
      <AuthProvider>
        <PushRefresh />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<SignUp />} />
              <Route path="/confirm" element={<ConfirmSignUp />} />
              <Route path="/forgot" element={<ForgotPassword />} />
              <Route path="/reset" element={<ResetPassword />} />
              <Route path="/callback" element={<Callback />} />
              <Route path="/s/:carId" element={<PublicVehicle />} />
              <Route path={GARAGE_PATH} element={<RequireAuth><Garage /></RequireAuth>} />
              <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
              <Route path="/cars/:id" element={<RequireAuth><Vehicle /></RequireAuth>} />
              <Route path="/cars/:id/chat/:sid" element={<RequireAuth><ChatConversation /></RequireAuth>} />
              <Route path="/admin" element={<RequireAdmin><Dashboard /></RequireAdmin>} />
              <Route path="/admin/users" element={<RequireAdmin><UserManagement /></RequireAdmin>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            </ErrorBoundary>
            <InstallPrompt />
          </BrowserRouter>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeModeProvider>
      <Root />
    </ThemeModeProvider>
  </StrictMode>,
);
