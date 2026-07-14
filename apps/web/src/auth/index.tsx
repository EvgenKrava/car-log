import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import {
  signIn as awsSignIn, signUp as awsSignUp, confirmSignUp as awsConfirmSignUp,
  resendSignUpCode, resetPassword, confirmResetPassword, signOut as awsSignOut,
  fetchAuthSession, getCurrentUser,
} from 'aws-amplify/auth';
import { configureAmplify } from './amplify';

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

  const refresh = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.accessToken?.toString();
      if (token) {
        const user = await getCurrentUser();
        setEmail(user.signInDetails?.loginId ?? user.username);
        setAccessToken(token);
        setStatus('authenticated');
      } else {
        setStatus('unauthenticated');
      }
    } catch {
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<AuthValue>(() => ({
    status, email, accessToken, refresh,
    signIn: async (e, p) => { await awsSignIn({ username: e, password: p }); await refresh(); },
    signUp: async (e, p) => { await awsSignUp({ username: e, password: p, options: { userAttributes: { email: e } } }); },
    confirmSignUp: async (e, c) => { await awsConfirmSignUp({ username: e, confirmationCode: c }); },
    resendCode: async (e) => { await resendSignUpCode({ username: e }); },
    forgotPassword: async (e) => { await resetPassword({ username: e }); },
    confirmForgotPassword: async (e, c, p) => { await confirmResetPassword({ username: e, confirmationCode: c, newPassword: p }); },
    signOut: async () => { await awsSignOut(); setStatus('unauthenticated'); setEmail(undefined); setAccessToken(undefined); },
  }), [status, email, accessToken, refresh]);

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
