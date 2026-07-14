import { type ReactNode } from 'react';
import { AuthProvider, useAuth, type AuthProviderProps } from 'react-oidc-context';
import { WebStorageStateStore } from 'oidc-client-ts';
import { CircularProgress, Box } from '@mui/material';

const oidcConfig: AuthProviderProps = {
  authority: import.meta.env.VITE_COGNITO_AUTHORITY,
  client_id: import.meta.env.VITE_COGNITO_CLIENT_ID,
  redirect_uri: import.meta.env.VITE_REDIRECT_URI,
  post_logout_redirect_uri: import.meta.env.VITE_LOGOUT_URI,
  response_type: 'code',
  scope: 'openid email profile',
  // Cognito uses its own domain for authorize/token; metadata is served at the authority.
  // Persist tokens in localStorage (not the default sessionStorage, which is per-tab and
  // cleared on tab/browser close) so the session — and Cognito's 30-day refresh token —
  // survives reloads and restarts. automaticSilentRenew (on by default) then refreshes the
  // short-lived access/id tokens, so the user isn't forced to re-login constantly.
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true,
};

export function AppAuthProvider({ children }: { children: ReactNode }) {
  return <AuthProvider {...oidcConfig}>{children}</AuthProvider>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.isLoading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
  }
  if (!auth.isAuthenticated) {
    void auth.signinRedirect();
    return null;
  }
  return <>{children}</>;
}
