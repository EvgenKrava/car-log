// The URL space the SPA owns, used by the service worker's navigation allowlist
// (apps/web/src/lib/app-routes.ts). onlytools.click is the landing; this host only serves the app.
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
