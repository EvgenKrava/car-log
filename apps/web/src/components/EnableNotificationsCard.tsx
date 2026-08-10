import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Snackbar, Stack, Typography } from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth';
import { pushSupported, isIOS, subscribeToPush } from '../lib/push';

const DENIED_DISMISS_KEY = 'carlog.pushDeniedDismissed';

// Profile-page card offering to turn on push notifications. Deliberately hides itself
// rather than showing a dead-end control: unsupported-and-not-iOS (nothing to do),
// already granted (nothing to ask), or a denied state the user already dismissed once.
export function EnableNotificationsCard() {
  const { t, i18n } = useTranslation(['push', 'common']);
  const { accessToken } = useAuth();
  const supported = pushSupported();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported',
  );
  const [deniedDismissed, setDeniedDismissed] = useState(
    () => localStorage.getItem(DENIED_DISMISS_KEY) === '1',
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [enabledOpen, setEnabledOpen] = useState(false);

  const lang: 'uk' | 'en' = i18n.language.startsWith('uk') ? 'uk' : 'en';

  // Must run synchronously inside the click handler — Notification.requestPermission()
  // called after an await (or from an effect) never shows the native iOS prompt.
  const onEnable = () => {
    if (!accessToken) return;
    setBusy(true);
    setFailed(false);
    subscribeToPush(accessToken, lang)
      .then(() => {
        setPermission('granted');
        setEnabledOpen(true);
      })
      .catch(() => {
        setPermission(supported ? Notification.permission : 'unsupported');
        setFailed(true);
      })
      .finally(() => setBusy(false));
  };

  const dismissDenied = () => {
    localStorage.setItem(DENIED_DISMISS_KEY, '1');
    setDeniedDismissed(true);
  };

  if (!supported && !isIOS()) return null;
  if (permission === 'granted') return null;
  if (permission === 'denied' && deniedDismissed) return null;

  return (
    <>
      <Card>
        <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1 }}>
            <Box
              sx={{
                width: 32, height: 32, borderRadius: 2, display: 'grid', placeItems: 'center',
                color: 'primary.main',
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.16)' : 'rgba(91,91,214,0.08)'),
              }}
            >
              <NotificationsActiveIcon sx={{ fontSize: 18 }} />
            </Box>
            <Typography variant="h6">{t('push:pushTitle')}</Typography>
          </Stack>

          <Typography color="text.secondary" sx={{ mb: 2 }}>{t('push:pushBody')}</Typography>

          {failed ? <Alert severity="error" sx={{ mb: 2 }}>{t('push:pushEnableFailed')}</Alert> : null}

          {!supported && isIOS() ? (
            <Typography variant="body2" color="text.secondary">{t('push:pushIosInstall')}</Typography>
          ) : permission === 'denied' ? (
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{t('push:pushDenied')}</Typography>
              <Button size="small" onClick={dismissDenied}>{t('push:pushDismiss')}</Button>
            </Stack>
          ) : (
            <Button variant="contained" onClick={onEnable} disabled={busy}>
              {t('push:pushEnable')}
            </Button>
          )}
        </CardContent>
      </Card>
      <Snackbar open={enabledOpen} autoHideDuration={4000} onClose={() => setEnabledOpen(false)}
        message={t('push:pushEnabled')} />
    </>
  );
}
