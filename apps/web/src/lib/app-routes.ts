import { APP_ROUTE_ROOTS, type AppRouteRoot } from '@carlog/config/app-routes';

// Navigations the service worker may answer with the SPA shell. Everything else — `/`,
// `/uk/…`, `/privacy`, `/terms`, sitemap, robots — must reach CloudFront for the static
// marketing files. The roots are shared with robots.txt and the CloudFront function.
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Workbox tests the allowlist against pathname + search, hence the `[?#]` alternatives.
const toRegExp = ({ path, kind }: AppRouteRoot): RegExp =>
  kind === 'exact' ? new RegExp(`^${escape(path)}(?:[?#]|$)`) : new RegExp(`^${escape(path)}(?:[/?#]|$)`);

export const APP_ROUTES: RegExp[] = APP_ROUTE_ROOTS.map(toRegExp);

export const isAppRoute = (pathname: string): boolean => APP_ROUTES.some((r) => r.test(pathname));
