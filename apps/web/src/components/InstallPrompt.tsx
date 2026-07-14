import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { resolveInstallMode, type InstallMode } from '../lib/install-mode';

const DISMISS_KEY = 'carlog.pwa.dismissed';

const isIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);

function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setPromptEvent(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const mode: InstallMode = installed
    ? 'none'
    : resolveInstallMode({
        hasPromptEvent: promptEvent !== null,
        isIOS: isIOS(),
        isStandalone: isStandalone(),
        dismissed,
      });

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
    dismiss();
  }, [promptEvent, dismiss]);

  return { mode, promptInstall, dismiss };
}

export function InstallPrompt() {
  const { mode, promptInstall, dismiss } = usePwaInstall();

  if (mode === 'none') return null;

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed', left: 16, right: 16, bottom: { xs: 96, sm: 16 },
        zIndex: (t) => t.zIndex.snackbar,
        p: 2, borderRadius: 3, maxWidth: 560, mx: 'auto',
      }}
    >
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1">Install CarLog for quick access</Typography>
          {mode === 'ios' ? (
            <Typography variant="body2" color="text.secondary">
              Tap the Share icon, then &ldquo;Add to Home Screen&rdquo;.
            </Typography>
          ) : null}
        </Box>
        <Stack direction="row" spacing={1}>
          {mode === 'android' ? (
            <Button variant="contained" onClick={() => void promptInstall()}>Install</Button>
          ) : null}
          <Button onClick={dismiss}>{mode === 'ios' ? 'Got it' : 'Not now'}</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
