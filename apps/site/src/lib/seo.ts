import type { Locale } from '../i18n';

export const SITE = 'https://carlog.onlytools.click';
export const CONTACT_EMAIL = 'evgen.cravchenco@gmail.com';
export const APP_HOME = '/garage';
export const APP_SIGNUP = '/signup';

// `path` is locale-less and starts with '/', e.g. '/' or '/privacy'.
export function localePath(locale: Locale, path: string): string {
  if (locale === 'en') return path;
  return path === '/' ? '/uk/' : `/uk${path}`;
}

export const otherLocale = (locale: Locale): Locale => (locale === 'en' ? 'uk' : 'en');

export const canonical = (locale: Locale, path: string): string => `${SITE}${localePath(locale, path)}`;

// hreflang set for one page: both locales plus x-default → English.
export function alternates(path: string): { hreflang: string; href: string }[] {
  return [
    { hreflang: 'en', href: canonical('en', path) },
    { hreflang: 'uk', href: canonical('uk', path) },
    { hreflang: 'x-default', href: canonical('en', path) },
  ];
}
