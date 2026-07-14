import { describe, expect, it } from 'vitest';
import { resolveInitialLanguage } from './resolve-language';

describe('resolveInitialLanguage', () => {
  it('uses stored language when supported', () => {
    expect(resolveInitialLanguage({ stored: 'uk', browser: 'en-US' })).toBe('uk');
  });
  it('ignores unsupported stored language and falls back to browser', () => {
    expect(resolveInitialLanguage({ stored: 'de', browser: 'uk' })).toBe('uk');
  });
  it('detects uk from a browser locale prefix', () => {
    expect(resolveInitialLanguage({ stored: null, browser: 'uk-UA' })).toBe('uk');
  });
  it('defaults to en when nothing matches', () => {
    expect(resolveInitialLanguage({ stored: null, browser: 'fr-FR' })).toBe('en');
  });
});
