import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static site served from the same S3 bucket + CloudFront distribution as the app.
// `directory` format emits /privacy/index.html; a CloudFront Function maps /privacy to it.
//
// `directory` output makes the sitemap plugin emit trailing-slash URLs (e.g. `/privacy/`),
// but src/lib/seo.ts canonicals are slash-less (`/privacy`) to match `trailingSlash: 'ignore'`.
// Strip the trailing slash from every non-root sitemap URL (and i18n alternate link) so the
// sitemap agrees with the page canonicals; `/` and `/uk/` keep theirs.
const ROOT_PATHS = new Set(['/', '/uk/']);
function stripTrailingSlash(url) {
  const u = new URL(url);
  if (!ROOT_PATHS.has(u.pathname) && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

export default defineConfig({
  site: 'https://carlog.onlytools.click',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'uk'],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'en', locales: { en: 'en', uk: 'uk' } },
      serialize(item) {
        item.url = stripTrailingSlash(item.url);
        if (item.links) item.links = item.links.map((link) => ({ ...link, url: stripTrailingSlash(link.url) }));
        return item;
      },
    }),
  ],
});
