export type InstallMode = 'android' | 'ios' | 'none';

export type InstallModeInput = {
  hasPromptEvent: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  dismissed: boolean;
};

export function resolveInstallMode({
  hasPromptEvent, isIOS, isStandalone, dismissed,
}: InstallModeInput): InstallMode {
  if (dismissed || isStandalone) return 'none';
  if (hasPromptEvent) return 'android';
  if (isIOS) return 'ios';
  return 'none';
}
