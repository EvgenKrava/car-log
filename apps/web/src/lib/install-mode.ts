export type InstallMode = 'android' | 'ios' | 'none';

export type InstallModeInput = {
  hasPromptEvent: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  dismissed: boolean;
};

// Single source of truth for "is this already running as an installed app" —
// previously duplicated across lib/push.ts, components/InstallPrompt.tsx, and
// an inline check in routes/Profile.tsx.
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// iOS Safari only exposes the Push API (and similarly gates some install UX) to an
// installed (standalone) PWA, never to a plain browser tab. Single source of truth —
// previously duplicated (as a near-identical regex) across lib/push.ts and
// components/InstallPrompt.tsx.
export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
}

export function resolveInstallMode({
  hasPromptEvent, isIOS: iOS, isStandalone: standalone, dismissed,
}: InstallModeInput): InstallMode {
  if (dismissed || standalone) return 'none';
  if (hasPromptEvent) return 'android';
  if (iOS) return 'ios';
  return 'none';
}
