# Public Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-JS, en+uk, search-indexable landing + legal site served at `https://carlog.onlytools.click/` from the same bucket/distribution as the app, with the app's home moved to `/garage`.

**Architecture:** New Astro package `apps/site` builds static HTML into `dist/`; `deploy-web.sh` merges it with the web build (whose shell is renamed `app.html`) into one S3 sync. CloudFront serves marketing files directly (a viewer-request Function appends `/index.html` to extensionless URIs) and falls back to `app.html` for SPA routes. The service worker only claims app navigations.

**Tech Stack:** Astro 7 (static), `@astrojs/sitemap`, `@fontsource/inter`, `sharp` (OG images, one-off), `playwright` (screenshot capture, one-off), `node-html-parser` (dist assertions), vitest, aws-cdk-lib CloudFront Function.

**Spec:** `docs/superpowers/specs/2026-09-15-marketing-site-design.md`

## Global Constraints

- **Spec is authoritative**; §N references below. Deviation noted in-plan: legal markdown is imported directly (`import * as doc from '../legal/en/privacy.md'`) instead of a content collection — same files, same output, one less moving part.
- Site origin: `https://carlog.onlytools.click`. Locales: `en` unprefixed, `uk` at `/uk/`. App home: `/garage`.
- Zero client-side JS on marketing pages. No analytics. No new monthly cost.
- Design tokens (spec §1): accent `#5B5BD6` / hover `#4A4AC4`; light bg `#F7F7FA`, surface `#FFFFFF`, text `#1B1B1F`; dark bg `#121215`, surface `#1C1C21`, text `#ECECF1`; max width 1080px; 16px gutters; single column < 720px.
- Copy (en + uk) is a **draft for owner review** — write it, mark nothing as TODO.
- Existing gates must stay green after every task: `pnpm turbo run build lint typecheck test`. Built `apps/web/dist/sw.js` contains 0 `execute-api` references.
- Strict TS, no `any`, no TODO/stubs, conventional commits, **no Co-Authored-By trailers**.
- Branch: `feat/marketing-site`.

---

## File Structure

- **`apps/site/`** (new) — `package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `src/i18n/{types,en,uk}.ts` (strings), `src/lib/seo.ts` (alternate/canonical helpers), `src/layouts/Base.astro` (head, header, footer), `src/styles/global.css` (tokens, reset), `src/components/{Hero,Features,HowItWorks,Faq,LangSwitch}.astro`, `src/pages/index.astro`, `src/pages/uk/index.astro`, `src/pages/{privacy,terms}.astro`, `src/pages/uk/{privacy,terms}.astro`, `src/legal/{en,uk}/{privacy,terms}.md` (moved from `apps/web/src/legal`), `src/assets/shots/*.png`, `public/robots.txt`, `public/og-{en,uk}.png`, `scripts/og.mjs`, `scripts/shots.mjs`, `test/dist.test.ts`.
- **`apps/web/`** — `src/lib/paths.ts` (new), `src/lib/app-routes.ts` (+ test, new), `src/lib/rename-index.ts` (+ test, new), `vite.config.ts`, `index.html`, `src/sw.ts`, `src/main.tsx`, the 12 navigation call sites, `routes/auth/Login.tsx`, `routes/Profile.tsx`; **delete** `src/routes/Legal.tsx`, `src/legal/`.
- **`infrastructure/cdk/lib/carlog-stack.ts`** (+ test) — fallback `app.html`, CloudFront Function.
- **`scripts/deploy-web.sh`**, **`turbo.json`**, **`pnpm-workspace.yaml`** (already `apps/*`).

---

### Task 1: Scaffold `apps/site` with layout, tokens, i18n, sitemap, and the dist test harness

**Files:**
- Create: `apps/site/package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `src/env.d.ts`, `src/styles/global.css`, `src/i18n/types.ts`, `src/i18n/en.ts`, `src/i18n/uk.ts`, `src/i18n/index.ts`, `src/lib/seo.ts`, `src/lib/seo.test.ts`, `src/layouts/Base.astro`, `src/components/LangSwitch.astro`, `src/pages/index.astro`, `src/pages/uk/index.astro`, `public/robots.txt`, `test/dist.test.ts`
- Modify: `turbo.json`

**Interfaces:**
- Produces: `type Locale = 'en' | 'uk'`; `type Strings` (full key set, see Step 3); `t(locale): Strings`; `altPath(locale, path)` → the same page in the other locale; `canonical(locale, path)`; `<Base locale title description path ogImage? jsonLd?>` layout wrapping page content.
- Later tasks add components into `src/components/` and pages under `src/pages/`.

- [ ] **Step 1: Package + config**

`apps/site/package.json`:

```json
{
  "name": "@carlog/site",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "typecheck": "astro check",
    "lint": "eslint src test --ext .ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@astrojs/sitemap": "^3.7.4",
    "@fontsource/inter": "^5.3.0",
    "astro": "^7.3.2"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.4",
    "@carlog/config": "workspace:*",
    "node-html-parser": "^7.0.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

`apps/site/astro.config.mjs`:

```js
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
```

`apps/site/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": { "types": ["astro/client"], "baseUrl": ".", "noEmit": true },
  "include": ["src", "test", "scripts"]
}
```

`apps/site/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] } });
```

`apps/site/src/env.d.ts`: `/// <reference types="astro/client" />`

`turbo.json` — add a package-scoped task so the dist assertions run against a fresh build:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "test": { "dependsOn": ["^build"] },
    "@carlog/site#test": { "dependsOn": ["build"] }
  }
}
```

Run `pnpm install` from the repo root.

- [ ] **Step 2: Global styles**

`apps/site/src/styles/global.css`:

```css
:root {
  --accent: #5B5BD6; --accent-hover: #4A4AC4;
  --bg: #F7F7FA; --surface: #FFFFFF; --text: #1B1B1F; --muted: #5F6070; --border: #E4E4EC;
  --radius: 14px; --max: 1080px; --gutter: 16px;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #121215; --surface: #1C1C21; --text: #ECECF1; --muted: #A5A6B5; --border: #2C2C34; }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 16px; line-height: 1.55;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; height: auto; display: block; }
.container { max-width: var(--max); margin: 0 auto; padding-inline: var(--gutter); }
.btn {
  display: inline-block; padding: 12px 20px; border-radius: 999px; font-weight: 600;
  background: var(--accent); color: #fff; border: 1px solid var(--accent);
}
.btn:hover { background: var(--accent-hover); text-decoration: none; }
.btn.secondary { background: transparent; color: var(--accent); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
h1, h2, h3 { line-height: 1.15; margin: 0 0 .5em; letter-spacing: -0.01em; }
h1 { font-size: clamp(2rem, 5vw, 3.25rem); font-weight: 800; }
h2 { font-size: clamp(1.5rem, 3vw, 2.125rem); font-weight: 700; }
h3 { font-size: 1.125rem; font-weight: 600; }
.muted { color: var(--muted); }
section { padding-block: 56px; }
@media (min-width: 720px) { section { padding-block: 80px; } }
```

- [ ] **Step 3: Strings (types + en + uk)**

`apps/site/src/i18n/types.ts`:

```ts
export type Locale = 'en' | 'uk';

export type Feature = { title: string; body: string };
export type Step = { title: string; body: string };
export type Faq = { q: string; a: string };

export type Strings = {
  siteName: string;
  metaTitle: string;
  metaDescription: string;
  nav: { features: string; how: string; faq: string; openApp: string };
  hero: { h1: string; sub: string; ctaPrimary: string; ctaSecondary: string; shotAlt: string };
  features: { h2: string; items: [Feature, Feature, Feature, Feature, Feature, Feature]; strip: [string, string, string, string] };
  how: { h2: string; steps: [Step, Step, Step] };
  faq: { h2: string; items: [Faq, Faq, Faq, Faq, Faq] };
  footer: { privacy: string; terms: string; contact: string; madeIn: string; language: string };
  legal: { back: string; updated: string };
};
```

`apps/site/src/i18n/en.ts`:

```ts
import type { Strings } from './types';

export const en: Strings = {
  siteName: 'CarLog',
  metaTitle: 'CarLog — your car\'s digital service book',
  metaDescription: 'Keep the full maintenance history of every car you own in one searchable timeline: services, receipts, photos, reminders. Free, works on your phone.',
  nav: { features: 'Features', how: 'How it works', faq: 'FAQ', openApp: 'Open app' },
  hero: {
    h1: 'Every car\'s full service history, in your pocket.',
    sub: 'CarLog replaces the glovebox notebook, the folder of receipts and the scattered photos with one searchable timeline per car — and reminds you before the next service is due.',
    ctaPrimary: 'Create free account',
    ctaSecondary: 'Open CarLog',
    shotAlt: 'CarLog timeline for a car on a phone',
  },
  features: {
    h2: 'Everything about the car, in one place',
    items: [
      { title: 'Service timeline', body: 'Every oil change, tyre swap and repair in date order, with mileage and cost. Search it in a second.' },
      { title: 'Receipts & photos', body: 'Attach invoices, photos and PDFs to any event. They stay private and are one tap away.' },
      { title: 'Reminders', body: 'By date or by mileage. Complete one and the next interval rolls forward automatically.' },
      { title: 'AI invoice scan', body: 'Snap a workshop invoice and CarLog pre-fills the event — parts, works, cost, date.' },
      { title: 'Bulk import', body: 'Paste years of history as text and get it back as structured events to review and confirm.' },
      { title: 'Chat & voice', body: 'Ask about your car in plain language, or dictate a note. It can add events and reminders for you.' },
    ],
    strip: ['Installable on your phone', 'English & Ukrainian', 'Light & dark', 'Free'],
  },
  how: {
    h2: 'How it works',
    steps: [
      { title: 'Add your car', body: 'Make, model, year, mileage. Takes a minute.' },
      { title: 'Log a service — or snap the invoice', body: 'Type it in, dictate it, or let the scanner read the paperwork.' },
      { title: 'Get reminded', body: 'CarLog tells you before the next service is due, by date or mileage.' },
    ],
  },
  faq: {
    h2: 'Questions',
    items: [
      { q: 'Is it free?', a: 'Yes. CarLog is free to use. AI features have fair daily limits per account.' },
      { q: 'Where is my data stored?', a: 'In AWS (N. Virginia). Files are private and only served through short-lived signed links. No trackers, no ads, nothing is sold.' },
      { q: 'Can I export or delete everything?', a: 'Yes. Export a car\'s full history as a file at any time, and delete your account — with all its data — from your profile in one step.' },
      { q: 'Does it work on my phone?', a: 'Yes. It\'s a web app you can install to your home screen on iPhone and Android; it also works in any desktop browser.' },
      { q: 'Is my data used to train AI?', a: 'No. Scans, imports, chat and dictation are processed inside AWS and are not used to train any model. Voice clips are discarded right after transcription.' },
    ],
  },
  footer: { privacy: 'Privacy', terms: 'Terms', contact: 'Contact', madeIn: 'Made in Ukraine', language: 'Language' },
  legal: { back: '← CarLog', updated: 'Last updated' },
};
```

`apps/site/src/i18n/uk.ts`:

```ts
import type { Strings } from './types';

export const uk: Strings = {
  siteName: 'CarLog',
  metaTitle: 'CarLog — цифрова сервісна книжка вашого авто',
  metaDescription: 'Уся історія обслуговування кожного вашого авто в одній стрічці з пошуком: сервіси, чеки, фото, нагадування. Безкоштовно, працює на телефоні.',
  nav: { features: 'Можливості', how: 'Як це працює', faq: 'Питання', openApp: 'Відкрити застосунок' },
  hero: {
    h1: 'Повна історія обслуговування кожного авто — у вашій кишені.',
    sub: 'CarLog замінює блокнот у бардачку, папку з чеками та розкидані фото однією стрічкою з пошуком для кожного авто — і нагадує, коли наближається наступний сервіс.',
    ctaPrimary: 'Створити безкоштовний акаунт',
    ctaSecondary: 'Відкрити CarLog',
    shotAlt: 'Стрічка обслуговування авто в CarLog на телефоні',
  },
  features: {
    h2: 'Усе про авто в одному місці',
    items: [
      { title: 'Стрічка обслуговування', body: 'Кожна заміна оливи, шин і ремонт у хронологічному порядку з пробігом і вартістю. Пошук за секунду.' },
      { title: 'Чеки та фото', body: 'Прикріплюйте рахунки, фото та PDF до будь-якої події. Вони приватні й доступні в один дотик.' },
      { title: 'Нагадування', body: 'За датою або пробігом. Виконали одне — наступний інтервал переноситься автоматично.' },
      { title: 'Сканування рахунків', body: 'Сфотографуйте рахунок із СТО — CarLog сам заповнить подію: роботи, запчастини, вартість, дату.' },
      { title: 'Масовий імпорт', body: 'Вставте роки історії текстом і отримайте структуровані події для перегляду та підтвердження.' },
      { title: 'Чат і голос', body: 'Запитуйте про авто звичайною мовою або надиктуйте нотатку. Асистент додасть події та нагадування за вас.' },
    ],
    strip: ['Встановлюється на телефон', 'Українська та англійська', 'Світла і темна тема', 'Безкоштовно'],
  },
  how: {
    h2: 'Як це працює',
    steps: [
      { title: 'Додайте авто', body: 'Марка, модель, рік, пробіг. Одна хвилина.' },
      { title: 'Запишіть сервіс — або сфотографуйте рахунок', body: 'Введіть вручну, надиктуйте або дайте сканеру прочитати папери.' },
      { title: 'Отримуйте нагадування', body: 'CarLog попередить перед наступним сервісом — за датою чи пробігом.' },
    ],
  },
  faq: {
    h2: 'Питання',
    items: [
      { q: 'Це безкоштовно?', a: 'Так. CarLog безкоштовний. Функції ШІ мають помірні денні ліміти на акаунт.' },
      { q: 'Де зберігаються мої дані?', a: 'В AWS (Північна Вірджинія). Файли приватні й видаються лише за короткочасними підписаними посиланнями. Без трекерів, реклами та продажу даних.' },
      { q: 'Чи можу я все експортувати або видалити?', a: 'Так. Експортуйте повну історію авто файлом будь-коли, а акаунт з усіма даними видаляється з профілю одним кроком.' },
      { q: 'Чи працює на телефоні?', a: 'Так. Це вебзастосунок, який можна встановити на головний екран iPhone чи Android; також працює в будь-якому браузері на комп\'ютері.' },
      { q: 'Чи використовуються мої дані для навчання ШІ?', a: 'Ні. Скани, імпорт, чат і голос обробляються всередині AWS і не використовуються для навчання моделей. Голосові записи видаляються одразу після транскрибації.' },
    ],
  },
  footer: { privacy: 'Конфіденційність', terms: 'Умови', contact: 'Контакт', madeIn: 'Зроблено в Україні', language: 'Мова' },
  legal: { back: '← CarLog', updated: 'Оновлено' },
};
```

`apps/site/src/i18n/index.ts`:

```ts
import type { Locale, Strings } from './types';
import { en } from './en';
import { uk } from './uk';

export type { Locale, Strings };
export const LOCALES: readonly Locale[] = ['en', 'uk'];
export const t = (locale: Locale): Strings => (locale === 'uk' ? uk : en);
```

- [ ] **Step 4: SEO helpers with tests**

`apps/site/src/lib/seo.ts`:

```ts
import type { Locale } from '../i18n';

export const SITE = 'https://carlog.onlytools.click';
export const CONTACT_EMAIL = 'evgen.cravchenco@gmail.com';
export const APP_HOME = '/garage';
export const APP_SIGNUP = '/signup';

// `path` is locale-less and starts with '/', e.g. '/' or '/privacy'.
export function localePath(locale: Locale, path: string): string {
  if (locale === 'en') return path;
  return path === '/' ? '/uk/' : `/uk${path}`;
}

export const otherLocale = (locale: Locale): Locale => (locale === 'en' ? 'uk' : 'en');

export const canonical = (locale: Locale, path: string): string => `${SITE}${localePath(locale, path)}`;

// hreflang set for one page: both locales plus x-default → English.
export function alternates(path: string): { hreflang: string; href: string }[] {
  return [
    { hreflang: 'en', href: canonical('en', path) },
    { hreflang: 'uk', href: canonical('uk', path) },
    { hreflang: 'x-default', href: canonical('en', path) },
  ];
}
```

`apps/site/src/lib/seo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { alternates, canonical, localePath, otherLocale } from './seo';

describe('seo helpers', () => {
  it('maps locale paths', () => {
    expect(localePath('en', '/')).toBe('/');
    expect(localePath('uk', '/')).toBe('/uk/');
    expect(localePath('en', '/privacy')).toBe('/privacy');
    expect(localePath('uk', '/privacy')).toBe('/uk/privacy');
  });
  it('builds canonical + hreflang set', () => {
    expect(canonical('uk', '/terms')).toBe('https://carlog.onlytools.click/uk/terms');
    expect(alternates('/').map((a) => a.hreflang)).toEqual(['en', 'uk', 'x-default']);
    expect(alternates('/')[2]?.href).toBe('https://carlog.onlytools.click/');
  });
  it('flips locales', () => { expect(otherLocale('en')).toBe('uk'); expect(otherLocale('uk')).toBe('en'); });
});
```

Run: `pnpm --filter @carlog/site test` → PASS (dist test is added in Step 7; it will fail until Step 6 builds — write it last).

- [ ] **Step 5: Layout + language switch**

`apps/site/src/components/LangSwitch.astro`:

```astro
---
import type { Locale } from '../i18n';
import { localePath, otherLocale } from '../lib/seo';
interface Props { locale: Locale; path: string; label: string }
const { locale, path, label } = Astro.props;
const other = otherLocale(locale);
---
<a href={localePath(other, path)} hreflang={other} lang={other} aria-label={label} class="lang">
  {other === 'uk' ? 'Українська' : 'English'}
</a>
<style>.lang { font-weight: 500; }</style>
```

`apps/site/src/layouts/Base.astro`:

```astro
---
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '../styles/global.css';
import { t, type Locale } from '../i18n';
import { alternates, canonical, APP_HOME, CONTACT_EMAIL, localePath } from '../lib/seo';
import LangSwitch from '../components/LangSwitch.astro';

interface Props {
  locale: Locale; path: string; title: string; description: string;
  ogImage?: string; jsonLd?: Record<string, unknown>; landing?: boolean;
}
const { locale, path, title, description, ogImage = `/og-${locale}.png`, jsonLd, landing = false } = Astro.props;
const s = t(locale);
const url = canonical(locale, path);
---
<!doctype html>
<html lang={locale}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={url} />
    {alternates(path).map((a) => <link rel="alternate" hreflang={a.hreflang} href={a.href} />)}
    <meta name="theme-color" content="#5B5BD6" />
    <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content={s.siteName} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={url} />
    <meta property="og:image" content={`${canonical('en', '/')}${ogImage.slice(1)}`} />
    <meta property="og:locale" content={locale === 'uk' ? 'uk_UA' : 'en_US'} />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="sitemap" href="/sitemap-index.xml" />
    {jsonLd && <script type="application/ld+json" set:html={JSON.stringify(jsonLd)} />}
  </head>
  <body>
    <header class="container">
      <a class="brand" href={localePath(locale, '/')}><img src="/icons/icon.svg" alt="" width="28" height="28" /> {s.siteName}</a>
      <nav>
        {landing && <a href="#features">{s.nav.features}</a>}
        {landing && <a href="#how">{s.nav.how}</a>}
        {landing && <a href="#faq">{s.nav.faq}</a>}
        <LangSwitch locale={locale} path={path} label={s.footer.language} />
        <a class="btn" href={APP_HOME}>{s.nav.openApp}</a>
      </nav>
    </header>
    <main><slot /></main>
    <footer class="container">
      <div class="links">
        <a href={localePath(locale, '/privacy')}>{s.footer.privacy}</a>
        <a href={localePath(locale, '/terms')}>{s.footer.terms}</a>
        <a href={`mailto:${CONTACT_EMAIL}`}>{s.footer.contact}</a>
        <LangSwitch locale={locale} path={path} label={s.footer.language} />
      </div>
      <p class="muted">© {new Date().getFullYear()} {s.siteName} · {s.footer.madeIn}</p>
    </footer>
  </body>
</html>
<style>
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-block: 16px; flex-wrap: wrap; }
  .brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 800; color: var(--text); font-size: 1.125rem; }
  nav { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  nav a:not(.btn) { color: var(--text); font-weight: 500; }
  footer { padding-block: 40px; border-top: 1px solid var(--border); margin-top: 40px; }
  .links { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 8px; }
  @media (max-width: 719px) { nav a:not(.btn):not(.lang) { display: none; } }
</style>
```

- [ ] **Step 6: Placeholder landing pages so the build produces both locales**

`apps/site/src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import { t } from '../i18n';
const locale = 'en';
const s = t(locale);
---
<Base locale={locale} path="/" title={s.metaTitle} description={s.metaDescription} landing>
  <section class="container"><h1>{s.hero.h1}</h1></section>
</Base>
```

`apps/site/src/pages/uk/index.astro` — identical with `locale = 'uk'` and `import Base from '../../layouts/Base.astro'; import { t } from '../../i18n';`.

`apps/site/public/robots.txt`:

```
User-agent: *
Allow: /
Disallow: /garage
Disallow: /cars/
Disallow: /profile
Disallow: /admin
Disallow: /login
Disallow: /signup
Disallow: /confirm
Disallow: /forgot
Disallow: /reset
Disallow: /callback
Disallow: /s/
Disallow: /app.html
Sitemap: https://carlog.onlytools.click/sitemap-index.xml
```

Run: `pnpm --filter @carlog/site build` → `dist/index.html`, `dist/uk/index.html`, `dist/sitemap-index.xml`, `dist/robots.txt` exist.

- [ ] **Step 7: Dist assertions**

`apps/site/test/dist.test.ts`:

```ts
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'node-html-parser';

const DIST = join(__dirname, '..', 'dist');
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
```

The OG image assertion fails until Task 4 — add two 1×1 placeholder PNGs now (`apps/site/public/og-en.png`, `og-uk.png`, generated with `python3 -c "import zlib,struct;..."` or copy `apps/web/public/icons/icon-192.png`) and replace them in Task 4.

- [ ] **Step 8: Gates + commit**

Run: `pnpm turbo run build lint typecheck test` → green (site test builds first via the turbo dependency).

```bash
git checkout -b feat/marketing-site
git add apps/site turbo.json pnpm-lock.yaml
git commit -m "feat(site): scaffold Astro marketing site with i18n layout, sitemap, robots, dist assertions"
```

---

### Task 2: Landing page sections

**Files:**
- Create: `apps/site/src/components/Hero.astro`, `Features.astro`, `HowItWorks.astro`, `Faq.astro`, `src/components/Landing.astro`, `src/lib/json-ld.ts` (+ test)
- Modify: `src/pages/index.astro`, `src/pages/uk/index.astro`

**Interfaces:**
- Consumes: `t(locale)`, `Base`, `APP_HOME`, `APP_SIGNUP`.
- Produces: `<Landing locale />` — the full page body; `softwareAppJsonLd(locale)`.
- Screenshots are wired in Task 4; until then components render without images.

- [ ] **Step 1: JSON-LD helper + test**

`apps/site/src/lib/json-ld.ts`:

```ts
import { t, type Locale } from '../i18n';
import { canonical } from './seo';

export function softwareAppJsonLd(locale: Locale): Record<string, unknown> {
  const s = t(locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: s.siteName,
    description: s.metaDescription,
    url: canonical(locale, '/'),
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Web',
    inLanguage: locale,
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };
}
```

`apps/site/src/lib/json-ld.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { softwareAppJsonLd } from './json-ld';

describe('softwareAppJsonLd', () => {
  it('is a free SoftwareApplication at the locale URL', () => {
    const ld = softwareAppJsonLd('uk');
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.url).toBe('https://carlog.onlytools.click/uk/');
    expect(ld.offers).toEqual({ '@type': 'Offer', price: 0, priceCurrency: 'USD' });
    expect(ld.inLanguage).toBe('uk');
  });
});
```

- [ ] **Step 2: Components**

`apps/site/src/components/Hero.astro`:

```astro
---
import type { Locale } from '../i18n';
import { t } from '../i18n';
import { APP_HOME, APP_SIGNUP } from '../lib/seo';
interface Props { locale: Locale }
const s = t(Astro.props.locale);
---
<section class="container hero">
  <div class="copy">
    <h1>{s.hero.h1}</h1>
    <p class="muted lead">{s.hero.sub}</p>
    <div class="ctas">
      <a class="btn" href={APP_SIGNUP}>{s.hero.ctaPrimary}</a>
      <a class="btn secondary" href={APP_HOME}>{s.hero.ctaSecondary}</a>
    </div>
  </div>
  <div class="shot"><slot /></div>
</section>
<style>
  .hero { display: grid; gap: 32px; align-items: center; }
  .lead { font-size: 1.125rem; max-width: 34rem; }
  .ctas { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
  .shot { display: flex; justify-content: center; }
  @media (min-width: 720px) { .hero { grid-template-columns: 1.1fr 0.9fr; } }
</style>
```

`apps/site/src/components/Features.astro`:

```astro
---
import type { Locale } from '../i18n';
import { t } from '../i18n';
interface Props { locale: Locale }
const s = t(Astro.props.locale);
const icons = ['🕒', '🧾', '🔔', '📷', '📥', '💬'];
---
<section id="features" class="container">
  <h2>{s.features.h2}</h2>
  <div class="grid">
    {s.features.items.map((f, i) => (
      <article class="card">
        <div class="icon" aria-hidden="true">{icons[i]}</div>
        <h3>{f.title}</h3>
        <p class="muted">{f.body}</p>
      </article>
    ))}
  </div>
  <ul class="strip">{s.features.strip.map((x) => <li>{x}</li>)}</ul>
</section>
<style>
  .grid { display: grid; gap: 16px; }
  .icon { font-size: 1.5rem; margin-bottom: 8px; }
  .strip { list-style: none; padding: 0; margin: 28px 0 0; display: flex; gap: 10px; flex-wrap: wrap; }
  .strip li { border: 1px solid var(--border); border-radius: 999px; padding: 6px 14px; font-size: .9rem; }
  @media (min-width: 720px) { .grid { grid-template-columns: repeat(3, 1fr); } }
</style>
```

`apps/site/src/components/HowItWorks.astro`:

```astro
---
import type { Locale } from '../i18n';
import { t } from '../i18n';
interface Props { locale: Locale }
const s = t(Astro.props.locale);
---
<section id="how" class="container">
  <h2>{s.how.h2}</h2>
  <ol class="steps">
    {s.how.steps.map((st, i) => (
      <li class="card"><span class="n">{i + 1}</span><h3>{st.title}</h3><p class="muted">{st.body}</p></li>
    ))}
  </ol>
</section>
<style>
  .steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 16px; counter-reset: s; }
  .n { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #fff; font-weight: 700; margin-bottom: 10px; }
  @media (min-width: 720px) { .steps { grid-template-columns: repeat(3, 1fr); } }
</style>
```

`apps/site/src/components/Faq.astro`:

```astro
---
import type { Locale } from '../i18n';
import { t } from '../i18n';
interface Props { locale: Locale }
const s = t(Astro.props.locale);
---
<section id="faq" class="container faq">
  <h2>{s.faq.h2}</h2>
  {s.faq.items.map((f) => (
    <details class="card"><summary>{f.q}</summary><p class="muted">{f.a}</p></details>
  ))}
</section>
<style>
  .faq { max-width: 760px; }
  details { margin-bottom: 10px; }
  summary { cursor: pointer; font-weight: 600; }
  details p { margin: 10px 0 0; }
</style>
```

`apps/site/src/components/Landing.astro`:

```astro
---
import type { Locale } from '../i18n';
import Hero from './Hero.astro';
import Features from './Features.astro';
import HowItWorks from './HowItWorks.astro';
import Faq from './Faq.astro';
interface Props { locale: Locale }
const { locale } = Astro.props;
---
<Hero locale={locale}><slot name="hero-shot" /></Hero>
<Features locale={locale} />
<HowItWorks locale={locale} />
<Faq locale={locale} />
```

- [ ] **Step 3: Pages use Landing + JSON-LD**

`apps/site/src/pages/index.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import Landing from '../components/Landing.astro';
import { t } from '../i18n';
import { softwareAppJsonLd } from '../lib/json-ld';
const locale = 'en';
const s = t(locale);
---
<Base locale={locale} path="/" title={s.metaTitle} description={s.metaDescription} jsonLd={softwareAppJsonLd(locale)} landing>
  <Landing locale={locale} />
</Base>
```

`uk/index.astro` mirrors it with `locale = 'uk'` and `../../` imports.

- [ ] **Step 4: Check in the browser, gates, commit**

`pnpm --filter @carlog/site dev` → `http://localhost:4321/` and `/uk/` render all sections at 390px and 1280px, light and dark (DevTools → Rendering → emulate `prefers-color-scheme`). Then `pnpm turbo run build lint typecheck test` green.

```bash
git add apps/site
git commit -m "feat(site): landing page — hero, features, how it works, FAQ, JSON-LD (en + uk)"
```

---

### Task 3: Legal pages move from the SPA to the site

**Files:**
- Move: `apps/web/src/legal/privacy.en.md` → `apps/site/src/legal/en/privacy.md` (and `uk`, `terms`)
- Create: `apps/site/src/layouts/Legal.astro`, `src/pages/privacy.astro`, `src/pages/terms.astro`, `src/pages/uk/privacy.astro`, `src/pages/uk/terms.astro`
- Delete: `apps/web/src/routes/Legal.tsx`
- Modify: `apps/web/src/main.tsx`, `routes/auth/Login.tsx`, `routes/Profile.tsx`

- [ ] **Step 1: Move the markdown, add frontmatter**

`git mv apps/web/src/legal/privacy.en.md apps/site/src/legal/en/privacy.md` (×4). Prepend frontmatter to each and drop the `_Last updated…_` italic line (the layout prints it):

```md
---
title: Privacy Policy
updated: 2026-09-14
---
```
(uk: `title: Політика конфіденційності`; terms: `Terms of Service` / `Умови використання`.) Keep the `# Heading` line out too — the layout renders `title` as `<h1>`.

- [ ] **Step 2: Legal layout + pages**

`apps/site/src/layouts/Legal.astro`:

```astro
---
import Base from './Base.astro';
import { t, type Locale } from '../i18n';
import { localePath } from '../lib/seo';
interface Props { locale: Locale; path: '/privacy' | '/terms'; title: string; updated: string; description: string }
const { locale, path, title, updated, description } = Astro.props;
const s = t(locale);
---
<Base locale={locale} path={path} title={`${title} — ${s.siteName}`} description={description}>
  <article class="container legal card">
    <a href={localePath(locale, '/')}>{s.legal.back}</a>
    <h1>{title}</h1>
    <p class="muted">{s.legal.updated}: {updated}</p>
    <slot />
  </article>
</Base>
<style>
  .legal { max-width: 760px; margin-block: 32px; }
  .legal :global(h2) { font-size: 1.25rem; margin-top: 1.6em; }
</style>
```

`apps/site/src/pages/privacy.astro`:

```astro
---
import Legal from '../layouts/Legal.astro';
import * as doc from '../legal/en/privacy.md';
const { title, updated } = doc.frontmatter as { title: string; updated: string };
---
<Legal locale="en" path="/privacy" title={title} updated={updated} description="What CarLog stores, why, and how to delete it.">
  <doc.Content />
</Legal>
```

`terms.astro` (description "The terms you agree to when using CarLog."), `uk/privacy.astro` (`../../legal/uk/privacy.md`, description "Що зберігає CarLog, навіщо і як це видалити."), `uk/terms.astro` ("Умови, з якими ви погоджуєтеся, користуючись CarLog.").

- [ ] **Step 3: Remove from the SPA; plain anchors**

- `apps/web/src/main.tsx`: delete the `Legal` lazy import and the two `/privacy` `/terms` routes.
- `git rm apps/web/src/routes/Legal.tsx`; `apps/web/src/legal/` is now empty — remove it.
- `Login.tsx` and `Profile.tsx`: the two links become `<Link href="/privacy" variant="caption" color="text.secondary">` / `href="/terms"` (MUI `Link` without `component={RouterLink}` renders an `<a>` — a full navigation to the static page).

- [ ] **Step 4: Gates, commit**

`pnpm turbo run build lint typecheck test` green; site dist test now also covers `/privacy`, `/terms`, `/uk/privacy`, `/uk/terms`.

```bash
git add apps/site apps/web
git commit -m "feat(site): privacy + terms pages served statically; SPA links to them"
```

---

### Task 4: Screenshots + OG images

**Files:**
- Create: `apps/site/scripts/shots.mjs`, `apps/site/scripts/og.mjs`, `apps/site/src/assets/shots/*.png`, `apps/site/public/og-en.png`, `public/og-uk.png` (replacing placeholders)
- Modify: `apps/site/package.json` (devDeps `playwright`, `sharp`; scripts `shots`, `og`), `src/pages/index.astro`, `uk/index.astro`, `src/components/Features.astro`

- [ ] **Step 1: Capture script (owner signs in; no credentials pass through the script)**

`pnpm --filter @carlog/site add -D playwright@^1.50.0 sharp@^0.35.4 && pnpm --filter @carlog/site exec playwright install chromium`

`apps/site/scripts/shots.mjs`:

```js
// Opens a headed Chromium with a persistent profile. Sign in with email/password in that
// window (Google blocks automated browsers), open a car with some history, then press
// Enter in this terminal. The script captures every route at phone + desktop, light +
// dark, into src/assets/shots/. Nothing about your session is stored in the repo.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const ORIGIN = process.env.SITE_ORIGIN ?? 'https://carlog.onlytools.click';
const OUT = new URL('../src/assets/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext('/tmp/carlog-shots-profile', { headless: false, viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto(`${ORIGIN}/login`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const carUrl = await rl.question('Sign in, open the car you want on the landing page, paste its URL here, then Enter: ');
rl.close();

const SIZES = { phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }, desktop: { width: 1280, height: 800, deviceScaleFactor: 2 } };
const ROUTES = { garage: `${ORIGIN}/garage`, timeline: carUrl.trim(), reminders: `${carUrl.trim()}?tab=reminders` };

for (const [sizeName, size] of Object.entries(SIZES)) {
  for (const scheme of ['light', 'dark']) {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: size.width, height: size.height });
    await p.emulateMedia({ colorScheme: scheme });
    for (const [routeName, url] of Object.entries(ROUTES)) {
      await p.goto(url, { waitUntil: 'networkidle' });
      await p.waitForTimeout(800);
      await p.screenshot({ path: `${OUT}${routeName}-${sizeName}-${scheme}.png`, fullPage: false });
      console.log('saved', `${routeName}-${sizeName}-${scheme}.png`);
    }
    await p.close();
  }
}
await ctx.close();
```

`package.json` scripts: `"shots": "node scripts/shots.mjs"`, `"og": "node scripts/og.mjs"`.

Run `pnpm --filter @carlog/site shots`. **Precondition:** the app's theme mode in Profile must be "System" so `prefers-color-scheme` emulation switches it. Review each PNG with the owner (personal data visible?) before continuing; re-shoot or crop as needed. Add `/tmp/carlog-shots-profile` nowhere near the repo (it isn't).

**Fallback** if the headed browser is impractical: the owner drops phone screenshots into `src/assets/shots/` named `timeline-phone-light.png` / `-dark.png` (minimum set); desktop shots are optional — Features cards then use the phone crops.

- [ ] **Step 2: Wire the hero + feature images**

`index.astro` / `uk/index.astro`:

```astro
---
import { Image } from 'astro:assets';
import shotLight from '../assets/shots/timeline-phone-light.png';
import shotDark from '../assets/shots/timeline-phone-dark.png';
// (uk: '../../assets/shots/…')
---
<Landing locale={locale}>
  <picture slot="hero-shot" class="phone">
    <source srcset={(await getImage({ src: shotDark, width: 390, format: 'webp' })).src} media="(prefers-color-scheme: dark)" />
    <Image src={shotLight} alt={s.hero.shotAlt} width={390} loading="eager" />
  </picture>
</Landing>
```
Add `import { getImage } from 'astro:assets';` and the top-level `await`. Style `.phone img { border-radius: 24px; box-shadow: 0 20px 60px rgba(0,0,0,.18); }` in `Hero.astro` via `:global(.phone img)`.

`Features.astro`: accept an optional `shots?: [ImageMetadata, …]` prop; when given, render `<Image src={shots[i]} alt="" width={640} loading="lazy" />` inside each card under the text. Pages pass `[timeline-desktop-light, timeline-desktop-light (cropped receipt), reminders-desktop-light, …]` — reuse the three route shots; not every card needs a unique image.

- [ ] **Step 3: OG images**

`apps/site/scripts/og.mjs`:

```js
// One-off: composes 1200×630 OG images from a gradient, the headline and the phone shot.
import sharp from 'sharp';
import { en } from '../src/i18n/en.ts';
import { uk } from '../src/i18n/uk.ts';

const shot = new URL('../src/assets/shots/timeline-phone-light.png', import.meta.url).pathname;
const out = (l) => new URL(`../public/og-${l}.png`, import.meta.url).pathname;

for (const [locale, s] of [['en', en], ['uk', uk]]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B5BD6"/><stop offset="1" stop-color="#2E2E8F"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <text x="72" y="220" font-family="Inter, Helvetica, Arial, sans-serif" font-size="58" font-weight="800" fill="#fff">${s.siteName}</text>
    <foreignObject x="72" y="260" width="620" height="300"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:34px;line-height:1.25;color:#fff;font-weight:600">${s.hero.h1}</div></foreignObject>
  </svg>`;
  const phone = await sharp(shot).resize({ width: 300 }).png().toBuffer();
  await sharp(Buffer.from(svg)).composite([{ input: phone, left: 830, top: 60 }]).png().toFile(out(locale));
  console.log('wrote', out(locale));
}
```
Run with `node --experimental-strip-types scripts/og.mjs` (Node ≥ 22.6) — or, if the TS import is refused, duplicate the two headline strings inline in the script. Commit the PNGs; delete the placeholders from Task 1.

- [ ] **Step 4: Gates, commit**

`pnpm turbo run build lint typecheck test` green (dist test now sees real OG PNGs; lint ignores `scripts/*.mjs` via the `.ts` ext filter).

```bash
git add apps/site
git commit -m "feat(site): real app screenshots in hero/features; OG images"
```

---

### Task 5: App — `/garage` home, `app.html` shell, SW allowlist

**Files:**
- Create: `apps/web/src/lib/paths.ts`, `src/lib/app-routes.ts`, `src/lib/app-routes.test.ts`, `src/lib/rename-index.ts`, `src/lib/rename-index.test.ts`
- Modify: `apps/web/vite.config.ts`, `index.html`, `src/sw.ts`, `src/main.tsx`, `src/auth/RequireAdmin.tsx`, `src/routes/{Callback,Vehicle,Profile,NotFound,PublicVehicle}.tsx`, `src/routes/auth/Login.tsx`, `src/routes/admin/{Dashboard,UserManagement}.tsx`

**Interfaces:**
- Produces: `GARAGE_PATH = '/garage'`; `APP_ROUTES: RegExp[]`; `isAppRoute(pathname): boolean`; `rekeyIndexHtml(bundle)`.

- [ ] **Step 1: Pure helpers with tests**

`apps/web/src/lib/paths.ts`:

```ts
// The app's home. `/` belongs to the static marketing site (served by CloudFront), so
// every in-app "go home" must target this instead.
export const GARAGE_PATH = '/garage';
```

`apps/web/src/lib/app-routes.ts`:

```ts
// Navigations the service worker may answer with the SPA shell. Everything else — `/`,
// `/uk/…`, `/privacy`, `/terms`, sitemap, robots — must reach CloudFront for the static
// marketing files. Keep in sync with the <Route> table in main.tsx.
export const APP_ROUTES: RegExp[] = [
  /^\/garage$/, /^\/cars\//, /^\/profile$/, /^\/login$/, /^\/signup$/, /^\/confirm$/,
  /^\/forgot$/, /^\/reset$/, /^\/callback$/, /^\/s\//, /^\/admin(\/|$)/,
];

export const isAppRoute = (pathname: string): boolean => APP_ROUTES.some((r) => r.test(pathname));
```

`apps/web/src/lib/app-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAppRoute } from './app-routes';

describe('isAppRoute', () => {
  it.each(['/garage', '/cars/abc', '/cars/abc/chat/s1', '/profile', '/login', '/s/xyz', '/admin', '/admin/users'])('%s is app', (p) => {
    expect(isAppRoute(p)).toBe(true);
  });
  it.each(['/', '/uk/', '/uk/privacy', '/privacy', '/terms', '/robots.txt', '/sitemap-index.xml', '/garages'])('%s is not', (p) => {
    expect(isAppRoute(p)).toBe(false);
  });
});
```

`apps/web/src/lib/rename-index.ts`:

```ts
// Re-keys the emitted `index.html` to `app.html` inside a Rollup bundle so the file is
// written under the new name and VitePWA's precache manifest (built afterwards from
// dist/) lists it. The dev server keeps serving index.html.
export function rekeyIndexHtml<T extends { fileName: string }>(bundle: Record<string, T>): void {
  const html = bundle['index.html'];
  if (!html) return;
  html.fileName = 'app.html';
  bundle['app.html'] = html;
  delete bundle['index.html'];
}
```

`apps/web/src/lib/rename-index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rekeyIndexHtml } from './rename-index';

describe('rekeyIndexHtml', () => {
  it('moves index.html to app.html and leaves other assets alone', () => {
    const bundle = { 'index.html': { fileName: 'index.html' }, 'assets/a.js': { fileName: 'assets/a.js' } };
    rekeyIndexHtml(bundle);
    expect(Object.keys(bundle).sort()).toEqual(['app.html', 'assets/a.js']);
    expect(bundle['app.html']?.fileName).toBe('app.html');
  });
  it('is a no-op without index.html', () => {
    const bundle = { 'assets/a.js': { fileName: 'assets/a.js' } };
    rekeyIndexHtml(bundle);
    expect(Object.keys(bundle)).toEqual(['assets/a.js']);
  });
});
```

Run: `pnpm --filter @carlog/web test` → PASS.

- [ ] **Step 2: Vite plugin, PWA start_url, noindex**

`apps/web/vite.config.ts`:

```ts
import type { Plugin } from 'vite';
import { rekeyIndexHtml } from './src/lib/rename-index';

// The marketing site owns `/index.html`; the SPA shell ships as `/app.html` (CloudFront's
// 403/404 fallback). Runs in generateBundle so VitePWA — which globs dist/ in closeBundle —
// precaches app.html, not a file that no longer exists.
const renameIndexToApp = (): Plugin => ({
  name: 'carlog-rename-index-to-app',
  apply: 'build',
  generateBundle(_options, bundle) { rekeyIndexHtml(bundle); },
});
```
Add `renameIndexToApp()` to `plugins` **before** `VitePWA(...)`. In the PWA manifest: `start_url: '/garage'`. Add `**/app.html` to nothing — `globPatterns` already matches `**/*.html`.

`apps/web/index.html`: add `<meta name="robots" content="noindex" />` in `<head>`.

- [ ] **Step 3: Service worker**

`apps/web/src/sw.ts`:

```ts
import { APP_ROUTES } from './lib/app-routes';
import { GARAGE_PATH } from './lib/paths';
// …
// Only app navigations get the SPA shell; marketing URLs fall through to the network so
// installed-PWA users still see the static pages.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/app.html'), { allowlist: APP_ROUTES }));
```
Both push fallbacks `?? '/'` → `?? GARAGE_PATH`.

- [ ] **Step 4: Route table + navigation call sites**

`main.tsx`: `import { GARAGE_PATH } from './lib/paths';` — `<Route path={GARAGE_PATH} element={<RequireAuth><Garage /></RequireAuth>} />` replaces the `path="/"` route. Then in each file replace the garage-meaning `'/'`:
- `Callback.tsx` (×2), `Login.tsx`, `Vehicle.tsx` (×3), `Profile.tsx`, `NotFound.tsx`, `admin/Dashboard.tsx`, `admin/UserManagement.tsx`: `navigate('/')` / `navigate('/', { replace: true })` → `navigate(GARAGE_PATH …)`.
- `RequireAdmin.tsx`: `<Navigate to={GARAGE_PATH} replace />`.
- `PublicVehicle.tsx` (×2): `to="/"` → `to={GARAGE_PATH}` (a logged-out visitor is redirected to `/login` by RequireAuth, same as before).
Verify: `grep -rnE "navigate\('/'|to=\"/\"" apps/web/src` → no results.

- [ ] **Step 5: Build checks, gates, commit**

```bash
pnpm --filter @carlog/web build
ls apps/web/dist/app.html && ! ls apps/web/dist/index.html
grep -c "app.html" apps/web/dist/sw.js          # ≥ 1 (precache entry + bound URL)
grep -c "execute-api" apps/web/dist/sw.js       # 0
grep -o '"start_url":"[^"]*"' apps/web/dist/manifest.webmanifest   # "/garage"
```
`pnpm turbo run build lint typecheck test` green. Dev server smoke: `/garage` after login, Profile → back arrow → `/garage`, `/privacy` link opens the static page (404 in dev — expected, served by CloudFront in prod).

```bash
git add apps/web
git commit -m "feat(web): home moves to /garage; SPA shell ships as app.html; SW claims app routes only"
```

---

### Task 6: CDK — `app.html` fallback + CloudFront URL-rewrite Function

**Files:**
- Modify: `infrastructure/cdk/lib/carlog-stack.ts`, `lib/carlog-stack.test.ts`

- [ ] **Step 1: Failing assertions**

Append to `carlog-stack.test.ts`:

```ts
it('falls back to the SPA shell app.html and rewrites extensionless URIs', () => {
  t.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      DefaultRootObject: 'index.html',
      CustomErrorResponses: Match.arrayWith([
        Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/app.html' }),
        Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/app.html' }),
      ]),
      DefaultCacheBehavior: Match.objectLike({
        FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' })],
      }),
    }),
  });
  t.resourceCountIs('AWS::CloudFront::Function', 1);
});
```

Run: `pnpm --filter @carlog/cdk test` → FAIL.

- [ ] **Step 2: Implement**

Imports: add `Function as CfFunction, FunctionCode, FunctionEventType` to the `aws-cdk-lib/aws-cloudfront` import. Before the `Distribution`:

```ts
// S3 behind OAC has no directory indexes. The static marketing site emits
// /privacy/index.html; this rewrite lets /privacy (and /uk, /uk/privacy…) hit it. App
// routes like /garage become /garage/index.html → 404 → the app.html fallback below.
const rewriteIndex = new CfFunction(this, 'RewriteIndex', {
  code: FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.endsWith('/')) { req.uri = uri + 'index.html'; }
  else if (!uri.includes('.')) { req.uri = uri + '/index.html'; }
  return req;
}`),
});
```
`defaultBehavior` gains `functionAssociations: [{ function: rewriteIndex, eventType: FunctionEventType.VIEWER_REQUEST }]`. `errorResponses` paths → `/app.html`. Comment the block: marketing at `/`, SPA shell at `/app.html`.

- [ ] **Step 3: Test, synth, commit**

`pnpm --filter @carlog/cdk test` PASS; `AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk synth > /dev/null` succeeds (unset `AWS_BEARER_TOKEN_BEDROCK` first).

```bash
git add infrastructure/cdk
git commit -m "feat(cdk): serve marketing HTML at /, SPA shell as app.html, CloudFront index rewrite"
```

---

### Task 7: Deploy script merges both builds

**Files:**
- Modify: `scripts/deploy-web.sh`

- [ ] **Step 1: Build both, detect collisions, single sync**

Replace the block from `pnpm --filter @carlog/web build` to the invalidation with:

```bash
pnpm --filter @carlog/site build
pnpm --filter @carlog/web build

# The site owns index.html, uk/, privacy/, terms/, og-*.png, robots.txt, sitemap-*.xml;
# the app owns app.html, assets/, sw.js, registerSW.js, manifest.webmanifest, icons/.
# Refuse to deploy if a path exists in both — the later copy would silently win.
DUP=$(comm -12 <(cd apps/site/dist && find . -type f | sort) <(cd apps/web/dist && find . -type f | sort))
if [ -n "$DUP" ]; then echo "Path collision between site and web builds:"; echo "$DUP"; exit 1; fi

STAGE=$(mktemp -d)
cp -R apps/site/dist/. "$STAGE"
cp -R apps/web/dist/. "$STAGE"
aws s3 sync "$STAGE" "s3://$BUCKET" --delete
# HTML, the service worker and the manifest must never be edge- or browser-cached, or
# clients get stuck on a stale shell / SW. Hashed assets/* and _astro/* stay long-cached.
aws s3 cp "$STAGE" "s3://$BUCKET" --recursive --exclude "*" --include "*.html" --include "sw.js" --include "manifest.webmanifest" --cache-control "no-cache"
rm -rf "$STAGE"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
echo "Deployed site + web to $WEB_URL"
```
Drop the two older single-file `s3 cp` lines (now covered). Keep the `.env.production` and Cognito reconcile parts unchanged.

- [ ] **Step 2: Dry run of the collision check + commit**

```bash
pnpm --filter @carlog/site build && pnpm --filter @carlog/web build
comm -12 <(cd apps/site/dist && find . -type f | sort) <(cd apps/web/dist && find . -type f | sort)   # prints nothing
git add scripts/deploy-web.sh
git commit -m "chore(deploy): merge marketing site and app builds into one S3 sync with collision check"
```

---

### Task 8: Deploy + live verification + handoff

- [ ] **Step 1: Merge to main, deploy CDK then web**

Follow superpowers:finishing-a-development-branch (owner chooses merge/PR). Then:

```bash
unset AWS_BEARER_TOKEN_BEDROCK
AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never
./scripts/deploy-web.sh
```

- [ ] **Step 2: Live checks (record in the PR/commit notes)**

```bash
W=https://carlog.onlytools.click
for p in / /uk/ /privacy /uk/terms; do printf "%-12s %s\n" $p "$(curl -s $W$p | grep -c '<h1')"; done   # each ≥ 1
curl -s $W/garage | grep -c 'name="robots" content="noindex"'   # 1 (SPA shell via fallback)
curl -s -o /dev/null -w "%{http_code}\n" $W/sitemap-index.xml    # 200
curl -s -o /dev/null -w "%{http_code}\n" $W/robots.txt           # 200
curl -sI $W/ | grep -i content-type                               # text/html
```
Browser: sign in → lands on `/garage`; Profile → Privacy opens the static page; sign out → lands on `/`; installed PWA (reinstall) opens on `/garage`; Lighthouse mobile on `/`: Performance ≥ 95, SEO ≥ 95, Accessibility ≥ 90 — fix anything below before calling it done.

- [ ] **Step 3: Owner handoff**

1. Google Search Console → add property `carlog.onlytools.click` (DNS TXT via Route53 or HTML tag in `Base.astro`) → submit `https://carlog.onlytools.click/sitemap-index.xml`.
2. Google Auth Platform → Branding: home page `/`, privacy `/privacy`, terms `/terms`; Audience → Publish.
3. Review the landing copy in `apps/site/src/i18n/{en,uk}.ts` — every string is a draft.

---

## Self-review

- **Spec coverage:** §1 site package → T1–T4; landing sections → T2 (+T4 images); SEO artefacts → T1 (robots, sitemap, hreflang, OG slots), T2 (JSON-LD), T4 (OG PNGs); screenshots → T4; §2 app → T3 (legal removal), T5; §3 CDK → T6; §4 deploy → T7; §5 testing → T1 (dist), T2 (json-ld), T5 (routes, rename), T6 (CDK), T8 (live); §6 rollout → T8.
- **Placeholders:** none; the two 1×1 placeholder PNGs in T1 are explicitly replaced in T4 and asserted by the dist test.
- **Type consistency:** `t(locale)`/`Strings` defined in T1 and consumed unchanged in T2–T4; `localePath`/`canonical`/`alternates` (T1) used by `Base`, `Legal`, `LangSwitch`; `APP_ROUTES`/`isAppRoute`/`GARAGE_PATH` (T5) match the `robots.txt` disallow list (T1) and the dist test's `APP_LINKS` (`/garage`, `/signup`); `rekeyIndexHtml` signature matches Rollup's `generateBundle` bundle shape (`fileName` on each entry); `app.html` name agrees across T5 (Vite/SW), T6 (CDK fallback), T7 (deploy), T1 (robots).
- **Deviation from spec noted:** legal pages import markdown directly (no content collection); Astro pinned to 7 (spec said 5).
