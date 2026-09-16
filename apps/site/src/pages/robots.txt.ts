import type { APIRoute } from 'astro';
import { APP_ROUTE_ROOTS } from '@carlog/config/app-routes';
import { SITE } from '../lib/seo';

// Crawlers get the marketing pages only. App routes come from the shared root list so this
// file, the service worker and the CloudFront function can never disagree; subtree roots get
// a trailing slash so `/s/` does not also block `/sitemap-index.xml` or `/signup`.
const disallow = APP_ROUTE_ROOTS.map(({ path, kind }) => `Disallow: ${kind === 'exact' ? path : `${path}/`}`);

export const GET: APIRoute = () =>
  new Response(['User-agent: *', 'Allow: /', ...disallow, 'Disallow: /app.html', `Sitemap: ${SITE}/sitemap-index.xml`, ''].join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
