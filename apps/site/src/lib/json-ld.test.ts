import { describe, expect, it } from 'vitest';
import { softwareAppJsonLd } from './json-ld';

describe('softwareAppJsonLd', () => {
  it('is a free SoftwareApplication at the locale URL', () => {
    const ld = softwareAppJsonLd('uk');
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.url).toBe('https://carlog.onlytools.click/uk/');
    expect(ld.offers).toEqual({ '@type': 'Offer', price: 0, priceCurrency: 'USD' });
    expect(ld.inLanguage).toBe('uk');
  });
});
