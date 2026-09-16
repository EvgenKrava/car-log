// The URL space the SPA owns. Everything else — `/`, `/uk/…`, `/privacy`, `/terms`, sitemap,
// robots — belongs to the static marketing site, and a URL under neither is a real 404.
//
// Single source of truth for three places that must agree:
//   apps/web        — the service worker's navigation allowlist (lib/app-routes.ts)
//   apps/site       — robots.txt Disallow lines (pages/robots.txt.ts)
//   infrastructure  — the CloudFront viewer-request function that serves app.html
// Keep in sync with the <Route> table in apps/web/src/main.tsx.
export type AppRouteRoot = {
  path: string;
  // `exact`: only this path (a query string / hash is fine, a trailing segment is not).
  // `subtree`: this path and everything below it.
  kind: 'exact' | 'subtree';
};

export const APP_ROUTE_ROOTS: readonly AppRouteRoot[] = [
  { path: '/garage', kind: 'exact' },
  { path: '/cars', kind: 'subtree' },
  { path: '/profile', kind: 'exact' },
  { path: '/login', kind: 'exact' },
  { path: '/signup', kind: 'exact' },
  { path: '/confirm', kind: 'exact' },
  { path: '/forgot', kind: 'exact' },
  { path: '/reset', kind: 'exact' },
  { path: '/callback', kind: 'exact' },
  { path: '/s', kind: 'subtree' },
  { path: '/admin', kind: 'subtree' },
];
