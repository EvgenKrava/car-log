import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static site served from the same S3 bucket + CloudFront distribution as the app.
// `directory` format emits /privacy/index.html; a CloudFront Function maps /privacy to it.
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
    sitemap({ i18n: { defaultLocale: 'en', locales: { en: 'en', uk: 'uk' } } }),
  ],
});
