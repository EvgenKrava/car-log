export type Language = 'en' | 'uk';
const SUPPORTED: readonly Language[] = ['en', 'uk'];

const isSupported = (v: string): v is Language => (SUPPORTED as readonly string[]).includes(v);

export function resolveInitialLanguage({ stored, browser }: { stored: string | null; browser: string }): Language {
  if (stored && isSupported(stored)) return stored;
  const prefix = browser.slice(0, 2).toLowerCase();
  if (isSupported(prefix)) return prefix;
  return 'en';
}
