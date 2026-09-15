import { describe, expect, it } from 'vitest';
import { isAppRoute } from './app-routes';

describe('isAppRoute', () => {
  it.each(['/garage', '/cars/abc', '/cars/abc/chat/s1', '/profile', '/login', '/s/xyz', '/admin', '/admin/users', '/garage?utm_source=x', '/callback?code=1&state=2'])('%s is app', (p) => {
    expect(isAppRoute(p)).toBe(true);
  });
  it.each(['/', '/uk/', '/uk/privacy', '/privacy', '/terms', '/robots.txt', '/sitemap-index.xml', '/garages'])('%s is not', (p) => {
    expect(isAppRoute(p)).toBe(false);
  });
});
