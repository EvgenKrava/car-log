import { t, type Locale } from '../i18n';
import { canonical } from './seo';

export function softwareAppJsonLd(locale: Locale): Record<string, unknown> {
  const s = t(locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: s.siteName,
    description: s.metaDescription,
    url: canonical(locale, '/'),
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Web',
    inLanguage: locale,
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };
}
