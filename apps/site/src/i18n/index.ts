import type { Locale, Strings } from './types';
import { en } from './en';
import { uk } from './uk';

export type { Locale, Strings };
export const LOCALES: readonly Locale[] = ['en', 'uk'];
export const t = (locale: Locale): Strings => (locale === 'uk' ? uk : en);
