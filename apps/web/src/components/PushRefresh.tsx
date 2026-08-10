import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth';
import { refreshPushSubscription } from '../lib/push';

// Silently re-syncs an already-granted push subscription with the server once per
// sign-in (a fresh row + refreshed TTL) — NOT on every proactive token refresh, which
// would re-POST hourly for no reason. Runs at the app shell rather than inside
// AuthProvider itself so the provider stays free of feature-specific side effects.
// Renders nothing.
export function PushRefresh() {
  const { status, accessToken } = useAuth();
  const { i18n } = useTranslation();
  const ranThisSession = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated' || !accessToken) {
      if (status === 'unauthenticated') ranThisSession.current = false;
      return;
    }
    if (ranThisSession.current) return;
    ranThisSession.current = true;
    const lang: 'uk' | 'en' = i18n.language.startsWith('uk') ? 'uk' : 'en';
    void refreshPushSubscription(accessToken, lang);
  }, [status, accessToken, i18n.language]);

  return null;
}
