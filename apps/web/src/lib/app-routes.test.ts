import { APP_ROUTE_ROOTS } from '@carlog/config/app-routes';
import { describe, expect, it } from 'vitest';
import { isAppRoute } from './app-routes';

describe('isAppRoute', () => {
  it.each(APP_ROUTE_ROOTS.map((r) => r.path))('%s (shared root) is app', (p) => {
    expect(isAppRoute(p)).toBe(true);
  });
  it.each(['/garage', '/cars', '/cars/abc', '/cars/abc/chat/s1', '/profile', '/login', '/s', '/s/xyz', '/admin', '/admin/users', '/garage?utm_source=x', '/callback?code=1&state=2'])('%s is app', (p) => {
    expect(isAppRoute(p)).toBe(true);
  });
  it.each(['/', '/uk/', '/uk/privacy', '/privacy', '/terms', '/robots.txt', '/sitemap-index.xml', '/garages', '/garage/more', '/carsx'])('%s is not', (p) => {
    expect(isAppRoute(p)).toBe(false);
  });
});
