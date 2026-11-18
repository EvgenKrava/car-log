export type Language = 'en' | 'uk' | 'ru';
export const SUPPORTED: readonly Language[] = ['en', 'uk', 'ru'];

const isSupported = (v: string): v is Language => (SUPPORTED as readonly string[]).includes(v);

export function resolveInitialLanguage({ stored, browser }: { stored: string | null; browser: string }): Language {
  if (stored && isSupported(stored)) return stored;
  const prefix = browser.slice(0, 2).toLowerCase();
  if (isSupported(prefix)) return prefix;
  return 'en';
}

/** The active language as one of ours (i18next may report e.g. "uk-UA"). */
export function currentLanguage(lng: string): Language {
  const p = lng.slice(0, 2).toLowerCase();
  return isSupported(p) ? p : 'en';
}
