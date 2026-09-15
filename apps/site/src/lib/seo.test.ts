import { describe, expect, it } from 'vitest';
import { alternates, canonical, localePath, otherLocale } from './seo';

describe('seo helpers', () => {
  it('maps locale paths', () => {
    expect(localePath('en', '/')).toBe('/');
    expect(localePath('uk', '/')).toBe('/uk/');
    expect(localePath('en', '/privacy')).toBe('/privacy');
    expect(localePath('uk', '/privacy')).toBe('/uk/privacy');
  });
  it('builds canonical + hreflang set', () => {
    expect(canonical('uk', '/terms')).toBe('https://carlog.onlytools.click/uk/terms');
    expect(alternates('/').map((a) => a.hreflang)).toEqual(['en', 'uk', 'x-default']);
    expect(alternates('/')[2]?.href).toBe('https://carlog.onlytools.click/');
  });
  it('flips locales', () => { expect(otherLocale('en')).toBe('uk'); expect(otherLocale('uk')).toBe('en'); });
});
