import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { signInWithRedirect, signOut as awsSignOut, fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { configureAmplify } from './amplify';
import { refreshDelayMs } from './token-refresh';
import { NoAccess } from './NoAccess';

export const ACCESS_GROUP = 'carlog-user';
export const ADMIN_GROUP = 'carlog-admin';

configureAmplify();

type Status = 'loading' | 'authenticated' | 'unauthenticated';

type AuthValue = {
  status: Status;
  email?: string;
  accessToken?: string;
  isAdmin: boolean;
  // Signed in to Only Tools, but CarLog is not granted to this account.
  hasAccess: boolean;
  groups: string[];
  // Sign-in and passwords are managed by Only Tools (auth.onlytools.click), so the app never
  // changes a password itself. Kept for the Profile screen, which hides the password row.
  isFederated: boolean;
  // GET /me has run for this session: it moves data from the old CarLog sign-in on the first visit.
  ready: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [email, setEmail] = useState<string | undefined>();
  const [accessToken, setAccessToken] = useState<string | undefined>();
  const [groups, setGroups] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

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
        const idPayload = session.tokens?.idToken?.payload as Record<string, unknown> | undefined;
        if (typeof idPayload?.email === 'string') setEmail(idPayload.email);
        setAccessToken(token);
        // Group membership rides in `cognito:groups` on both the ID and access
        // tokens, but for federated (Google) identities the access token can omit
        // it — so read from BOTH and union.
        const merged = new Set<string>();
        for (const src of [session.tokens?.idToken?.payload, session.tokens?.accessToken?.payload]) {
          const raw = src?.['cognito:groups'];
          if (Array.isArray(raw)) for (const g of raw) merged.add(String(g));
        }
        setGroups([...merged]);
        setStatus('authenticated');
        scheduleRefresh(token);
      } else {
        clearRefreshTimer();
        setGroups([]);
        setStatus('unauthenticated');
      }
    } catch {
      clearRefreshTimer();
      setGroups([]);
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

  const isAdmin = groups.includes(ADMIN_GROUP);
  const hasAccess = isAdmin || groups.includes(ACCESS_GROUP);

  // Once per session, before any screen loads data: GET /me finishes the move from the old
  // CarLog sign-in (the first time only). A failure must not lock the user out.
  const meStarted = useRef(false);
  useEffect(() => {
    if (status !== 'authenticated' || !hasAccess || !accessToken || meStarted.current) return;
    meStarted.current = true;
    fetch(`${import.meta.env.VITE_API_URL as string}/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [status, hasAccess, accessToken]);

  const value = useMemo<AuthValue>(() => ({
    status, email, accessToken, groups, isAdmin, hasAccess, isFederated: true, ready, refresh,
    signIn: async () => { await signInWithRedirect(); },
    signOut: async () => { clearRefreshTimer(); await awsSignOut(); setStatus('unauthenticated'); setEmail(undefined); setAccessToken(undefined); setGroups([]); },
  }), [status, email, accessToken, groups, isAdmin, hasAccess, ready, refresh, clearRefreshTimer]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, hasAccess, ready } = useAuth();
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  if (status === 'authenticated' && !hasAccess) return <NoAccess />;
  if (status === 'loading' || !ready) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
  }
  return <>{children}</>;
}
