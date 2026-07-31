import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import {
  signIn as awsSignIn, signUp as awsSignUp, confirmSignUp as awsConfirmSignUp,
  resendSignUpCode, resetPassword, confirmResetPassword, signOut as awsSignOut,
  fetchAuthSession, getCurrentUser,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { configureAmplify } from './amplify';
import { refreshDelayMs } from './token-refresh';

configureAmplify();

type Status = 'loading' | 'authenticated' | 'unauthenticated';

type AuthValue = {
  status: Status;
  email?: string;
  accessToken?: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  confirmForgotPassword: (email: string, code: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [email, setEmail] = useState<string | undefined>();
  const [accessToken, setAccessToken] = useState<string | undefined>();

  // Proactive-refresh timer. Cognito access tokens expire (~1h); we re-run refresh()
  // shortly before expiry so the cached token never goes stale. fetchAuthSession()
  // transparently mints a fresh token from the refresh token when the current one is near expiry.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  const clearRefreshTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback((token: string) => {
    clearRefreshTimer();
    timerRef.current = setTimeout(() => { refreshRef.current(); }, refreshDelayMs(token));
  }, [clearRefreshTimer]);

  const refresh = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.accessToken?.toString();
      if (token) {
        const user = await getCurrentUser();
        setEmail(user.signInDetails?.loginId ?? user.username);
        setAccessToken(token);
        setStatus('authenticated');
        scheduleRefresh(token);
      } else {
        clearRefreshTimer();
        setStatus('unauthenticated');
      }
    } catch {
      clearRefreshTimer();
      setStatus('unauthenticated');
    }
  }, [scheduleRefresh, clearRefreshTimer]);

  // Keep the ref pointing at the latest refresh so the scheduled timer never fires a stale closure.
  refreshRef.current = () => { void refresh(); };

  useEffect(() => {
    void refresh();
    return () => clearRefreshTimer();
  }, [refresh, clearRefreshTimer]);

  // Federated sign-ins complete outside the normal signIn() call path, so listen on
  // the Amplify Hub and refresh session state whenever auth changes anywhere.
  useEffect(() => {
    const stop = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect' || payload.event === 'signedIn' || payload.event === 'signedOut') {
        void refresh();
      }
    });
    return () => stop();
  }, [refresh]);

  // Re-validate promptly when the tab regains focus/visibility (e.g. a laptop waking from sleep),
  // where a scheduled timer may have been throttled or skipped while backgrounded.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const value = useMemo<AuthValue>(() => ({
    status, email, accessToken, refresh,
    signIn: async (e, p) => { await awsSignIn({ username: e, password: p }); await refresh(); },
    signUp: async (e, p) => { await awsSignUp({ username: e, password: p, options: { userAttributes: { email: e } } }); },
    confirmSignUp: async (e, c) => { await awsConfirmSignUp({ username: e, confirmationCode: c }); },
    resendCode: async (e) => { await resendSignUpCode({ username: e }); },
    forgotPassword: async (e) => { await resetPassword({ username: e }); },
    confirmForgotPassword: async (e, c, p) => { await confirmResetPassword({ username: e, confirmationCode: c, newPassword: p }); },
    signOut: async () => { clearRefreshTimer(); await awsSignOut(); setStatus('unauthenticated'); setEmail(undefined); setAccessToken(undefined); },
  }), [status, email, accessToken, refresh, clearRefreshTimer]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
  }
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
