import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'node-html-parser';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const SITE = 'https://carlog.onlytools.click';
// App routes the landing links to; they are served by the SPA shell, not by dist/.
const APP_LINKS = new Set(['/garage', '/signup']);

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? htmlFiles(p) : p.endsWith('.html') ? [p] : [];
  });
}

// '/privacy' → dist/privacy/index.html ; '/' → dist/index.html ; '/uk/' → dist/uk/index.html
const fileFor = (path: string): string => join(DIST, path.endsWith('/') ? `${path}index.html` : `${path}/index.html`);

describe('built site', () => {
  const pages = htmlFiles(DIST);
  it('has both locales of every page', () => {
    const rel = pages.map((p) => relative(DIST, p));
    for (const p of rel.filter((r) => !r.startsWith('uk/'))) expect(rel).toContain(`uk/${p}`);
  });

  it.each(pages.map((p) => [relative(DIST, p), p]))('%s carries the SEO head', (_rel, file) => {
    const doc = parse(readFileSync(file, 'utf8'));
    expect(doc.querySelector('title')?.text.trim()).toBeTruthy();
    expect(doc.querySelector('meta[name="description"]')?.getAttribute('content')).toBeTruthy();
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
    expect(canonical.startsWith(SITE)).toBe(true);
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toMatch(/\/og-(en|uk)\.png$/);
    const hreflangs = doc.querySelectorAll('link[rel="alternate"][hreflang]').map((l) => l.getAttribute('hreflang'));
    expect(hreflangs.sort()).toEqual(['en', 'uk', 'x-default']);
    for (const l of doc.querySelectorAll('link[rel="alternate"][hreflang]')) {
      const path = (l.getAttribute('href') ?? '').slice(SITE.length);
      expect(existsSync(fileFor(path)), `alternate ${path} missing`).toBe(true);
    }
    expect(doc.querySelectorAll('script:not([type="application/ld+json"])')).toHaveLength(0);
  });

  it.each(pages.map((p) => [relative(DIST, p), p]))('%s internal links resolve', (_rel, file) => {
    const doc = parse(readFileSync(file, 'utf8'));
    for (const a of doc.querySelectorAll('a[href^="/"]')) {
      const href = (a.getAttribute('href') ?? '').split('#')[0] ?? '';
      if (!href || APP_LINKS.has(href)) continue;
      expect(existsSync(fileFor(href)) || existsSync(join(DIST, href)), `${href} not in dist`).toBe(true);
    }
  });

  it('ships robots.txt, sitemap and OG images', () => {
    expect(existsSync(join(DIST, 'robots.txt'))).toBe(true);
    expect(existsSync(join(DIST, 'sitemap-index.xml'))).toBe(true);
    expect(readFileSync(join(DIST, 'robots.txt'), 'utf8')).toContain('Sitemap: https://carlog.onlytools.click/sitemap-index.xml');
    for (const f of ['og-en.png', 'og-uk.png']) expect(existsSync(join(DIST, f)), f).toBe(true);
  });
});
