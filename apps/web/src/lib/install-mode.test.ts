import { describe, expect, it } from 'vitest';
import { resolveInstallMode } from './install-mode';

const base = { hasPromptEvent: false, isIOS: false, isStandalone: false, dismissed: false };

describe('resolveInstallMode', () => {
  it('returns none when already dismissed', () => {
    expect(resolveInstallMode({ ...base, dismissed: true, hasPromptEvent: true })).toBe('none');
  });

  it('returns none when running standalone (already installed)', () => {
    expect(resolveInstallMode({ ...base, isStandalone: true, hasPromptEvent: true })).toBe('none');
  });

  it('returns android when a prompt event is captured', () => {
    expect(resolveInstallMode({ ...base, hasPromptEvent: true })).toBe('android');
  });

  it('returns ios on iOS Safari that is not standalone', () => {
    expect(resolveInstallMode({ ...base, isIOS: true })).toBe('ios');
  });

  it('returns none on plain desktop (no event, not iOS)', () => {
    expect(resolveInstallMode(base)).toBe('none');
  });

  it('prefers android over ios when both a prompt event and iOS are somehow present', () => {
    expect(resolveInstallMode({ ...base, hasPromptEvent: true, isIOS: true })).toBe('android');
  });
});
