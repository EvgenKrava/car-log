// Navigations the service worker may answer with the SPA shell. Everything else — `/`,
// `/uk/…`, `/privacy`, `/terms`, sitemap, robots — must reach CloudFront for the static
// marketing files. Keep in sync with the <Route> table in main.tsx.
export const APP_ROUTES: RegExp[] = [
  /^\/garage$/, /^\/cars\//, /^\/profile$/, /^\/login$/, /^\/signup$/, /^\/confirm$/,
  /^\/forgot$/, /^\/reset$/, /^\/callback$/, /^\/s\//, /^\/admin(\/|$)/,
];

export const isAppRoute = (pathname: string): boolean => APP_ROUTES.some((r) => r.test(pathname));
