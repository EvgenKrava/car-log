# Public Marketing Site — carlog.onlytools.click

**Date:** 2026-09-15
**Status:** Approved

## Goal

A public, search-indexable landing site for CarLog at the brand URL, so people can find
the product, understand it in 30 seconds, and sign up — at zero incremental hosting cost.
Launch scope is **landing + legal** in English and Ukrainian; feature pages and a blog are
explicitly out of scope.

## Decisions taken (2026-09-15)

| Question | Decision |
|---|---|
| Where | `carlog.onlytools.click` root; the app's home moves `/` → `/garage` |
| Languages | English at `/`, Ukrainian at `/uk/`, hreflang both ways |
| Scope | Landing + `/privacy` + `/terms` (moved out of the SPA) |
| Screenshots | Captured from the owner's session in the Browser pane, both themes, phone + desktop |
| Approach | Astro static site in `apps/site`, same S3 bucket + CloudFront distribution |
| Analytics | None (privacy policy promises no trackers) |

## Constraints

- **$0/month incremental.** Same bucket, same distribution, same cert. The only new
  resource is one CloudFront Function (free tier: 2M invocations/month).
- **Zero client-side JavaScript** on marketing pages. Language switching is plain links.
- **Copy is a draft** written by the assistant in en + uk; the owner reviews before launch.
- Existing gates stay green: `pnpm turbo run build lint typecheck test`; built `sw.js`
  contains 0 `execute-api` references; strict TS; no TODO/stubs.

---

## 1. Site package — `apps/site`

- Astro 5, `output: 'static'`, `@astrojs/sitemap`, `@fontsource/inter` (400/500/700).
  No UI framework, no client scripts. Plain scoped CSS with custom properties.
- **i18n:** `i18n: { defaultLocale: 'en', locales: ['en', 'uk'], routing: { prefixDefaultLocale: false } }`.
  Strings live in `src/i18n/{en,uk}.ts` (typed object, identical keys). Pages are
  `src/pages/index.astro`, `src/pages/uk/index.astro`, `src/pages/[privacy|terms].astro`,
  `src/pages/uk/[privacy|terms].astro` — the uk pages reuse the same components with
  `lang="uk"`.
- **Legal:** markdown moves from `apps/web/src/legal/*.md` to
  `apps/site/src/content/legal/{privacy,terms}.{en,uk}.md` (Astro content collection,
  schema `{ title: string; updated: string }` in frontmatter). Rendered inside the shared
  layout with a "← CarLog" link.
- **Layout (`src/layouts/Base.astro`)** sets per page: `<html lang>`, `<title>`,
  description, canonical, `<link rel="alternate" hreflang="en|uk|x-default">`,
  OG/Twitter tags (`og:image` = `/og-en.png` or `/og-uk.png`), `theme-color`, favicon
  (reuse `apps/web/public/icons/icon.svg` + `icon-192.png`), and the JSON-LD block on the
  landing pages only.
- **Design tokens:** accent `#5B5BD6`, hover `#4A4AC4`; light background `#F7F7FA`,
  surface `#FFFFFF`, text `#1B1B1F`; dark background `#121215`, surface `#1C1C21`, text
  `#ECECF1`. `prefers-color-scheme` switches. Max content width 1080px; 16px side gutters;
  mobile-first, single column under 720px.

### Landing page sections

1. **Header** — logo + "CarLog", links: Features · How it works · FAQ, language switch
   (EN / UK), **Open app** → `/garage`.
2. **Hero** — h1 *"Every car's full service history, in your pocket."* (uk: *"Повна
   історія обслуговування кожного авто — у вашій кишені."*), subhead: one sentence about
   replacing notebooks/receipts/photos with one searchable timeline. CTAs: **Create free
   account** → `/signup` (primary), **Open CarLog** → `/garage`. Phone screenshot of the
   timeline (light in light mode, dark in dark mode via `<picture>` + media query).
3. **Features** — 6 cards, each icon + title + 1–2 sentences + screenshot crop:
   service timeline · receipts & photos · reminders (date/mileage) · AI invoice scan ·
   bulk text import · chat with voice. Strip below: *Installable PWA · English & Ukrainian
   · Light & dark · Free*.
4. **How it works** — 3 numbered steps: add a car → log a service or snap the invoice →
   get reminded before it's due.
5. **FAQ** — 5 `<details>` items: Is it free? Where is my data stored? Can I export or
   delete everything? Does it work on my phone / offline? Is my data used to train AI?
   Answers must match the privacy policy text.
6. **Footer** — Privacy · Terms · contact `evgen.cravchenco@gmail.com` · language switch
   · "Made in Ukraine".

### SEO artefacts

- `robots.txt`: `Allow: /`, `Disallow: /garage /cars/ /profile /admin /login /signup
  /confirm /forgot /reset /callback /s/ /app.html`, `Sitemap:` line.
- Sitemap from `@astrojs/sitemap` with i18n config (en/uk alternates).
- JSON-LD `SoftwareApplication`: name, description, url, `applicationCategory:
  "UtilitiesApplication"`, `operatingSystem: "Web"`, `offers: { price: 0, priceCurrency: "USD" }`,
  `inLanguage`.
- OG images: `public/og-en.png`, `public/og-uk.png` (1200×630), generated once by
  `scripts/og.mjs` (sharp: gradient background, title, phone screenshot) and committed.

### Screenshots

Captured from the owner's signed-in session in the Browser pane: Garage, Vehicle
timeline, event with attachments, reminders, scan dialog, chat — at 390×844 (phone) and
1280×800 (desktop), light and dark. Stored as PNG under `apps/site/src/assets/shots/`,
optimized to WebP by `astro:assets` at build. Each shot is shown to the owner before use.

---

## 2. App changes — `apps/web`

- `src/lib/paths.ts`: `export const GARAGE_PATH = '/garage';`. Every `navigate('/')`,
  `to="/"`, `Navigate to="/"` that means "go to garage" uses it (Callback, Login,
  Vehicle ×3, Profile, NotFound, PublicVehicle ×2, admin Dashboard/UserManagement,
  RequireAdmin). Route table: `<Route path={GARAGE_PATH} …>`; no `/` route.
- `vite.config.ts`: PWA `start_url: '/garage'` (scope stays `/`); new inline plugin
  `renameIndexToApp()` — in `generateBundle`, re-key `index.html` → `app.html` so
  VitePWA's precache manifest (which runs after) lists `app.html`. Dev server keeps
  serving `index.html`.
- `index.html`: add `<meta name="robots" content="noindex">` — it becomes `app.html`, the
  SPA shell for every app route; it must never be indexed.
- `src/sw.ts`: `new NavigationRoute(createHandlerBoundToURL('/app.html'), { allowlist: APP_ROUTES })`
  where `APP_ROUTES` is exported from `src/lib/app-routes.ts` as regexes for
  `/garage`, `/cars/`, `/profile`, `/login`, `/signup`, `/confirm`, `/forgot`, `/reset`,
  `/callback`, `/s/`, `/admin`. Navigations to anything else (`/`, `/uk/…`, `/privacy`,
  `/terms`) bypass the SW and reach CloudFront.
- Remove `src/routes/Legal.tsx`, `src/legal/`, and the two `/privacy` `/terms` routes.
  Login and Profile link to `/privacy` and `/terms` with `<Link href>` (MUI anchor, full
  navigation), not `RouterLink`.
- i18n: no new strings; `auth:privacy` / `auth:terms` stay.

## 3. Infrastructure — CDK

- `Distribution`: `defaultRootObject: 'index.html'` (now the marketing page);
  `errorResponses` 403/404 → `responsePagePath: '/app.html'`.
- `cloudfront.Function` `RewriteIndex` on `VIEWER_REQUEST` of the default behaviour:
  ```js
  function handler(event) {
    var req = event.request;
    var uri = req.uri;
    if (uri.endsWith('/')) { req.uri = uri + 'index.html'; }
    else if (!uri.includes('.')) { req.uri = uri + '/index.html'; }
    return req;
  }
  ```
  `/privacy` → `/privacy/index.html` (exists); `/garage` → `/garage/index.html` (404 →
  `app.html` fallback → SPA). Assets with extensions pass through.
- Stack test: fallback path is `/app.html`; a `AWS::CloudFront::Function` exists and the
  default behaviour references it with `EventType: viewer-request`.

## 4. Deploy — `scripts/deploy-web.sh`

```
pnpm --filter @carlog/site build && pnpm --filter @carlog/web build
STAGE=$(mktemp -d); cp -R apps/site/dist/. "$STAGE"; cp -R apps/web/dist/. "$STAGE"
aws s3 sync "$STAGE" "s3://$BUCKET" --delete
# no-cache for everything that must not be edge-stale
aws s3 cp "$STAGE" "s3://$BUCKET" --recursive --exclude "*" --include "*.html" --include "sw.js" --include "manifest.webmanifest" --cache-control no-cache
aws cloudfront create-invalidation …
```
The two builds must not emit the same path: the site owns `index.html`, `uk/`,
`privacy/`, `terms/`, `og-*.png`, `robots.txt`, `sitemap-*.xml`; the web owns
`app.html`, `assets/`, `sw.js`, `registerSW.js`, `manifest.webmanifest`, `icons/`,
`apple-touch-icon.png`. The deploy script fails if a file exists in both.

## 5. Testing

- **`apps/site`** (`vitest`, runs after `astro build`): for every `dist/**/*.html`
  assert `<title>`, `meta[name=description]`, `link[rel=canonical]`, `og:title`,
  `og:image`; for landing/legal pages assert `hreflang` en+uk+x-default and that the
  alternate URL exists in `dist`; every internal `href` resolves to a file in `dist` or to
  an app route in `APP_ROUTES` (`/garage`, `/signup`). `robots.txt` and
  `sitemap-index.xml` exist.
- **`apps/web`**: unit tests for `renameIndexToApp` (bundle re-key) and for the
  `APP_ROUTES` matcher (`/garage` ✓, `/cars/x` ✓, `/` ✗, `/uk/` ✗, `/privacy` ✗). Existing
  SW gate unchanged.
- **CDK**: assertions above.
- **Live** (after deploy): `curl` `/`, `/uk/`, `/privacy` return marketing HTML (contains
  `<h1`); `/garage` returns `app.html` with `noindex`; `/sitemap-index.xml` 200; sign
  out lands on `/`; installed PWA opens on `/garage`; Lighthouse mobile on `/`:
  performance ≥ 95, SEO ≥ 95.

## 6. Rollout

1. Merge; `cdk deploy` (function + fallback). Until the web deploy, `/` still serves the
   old SPA `index.html` — harmless.
2. `./scripts/deploy-web.sh` — marketing + app together.
3. Google Search Console: add property `carlog.onlytools.click`, submit sitemap (owner).
4. Google Auth Platform → Branding: home page `/`, privacy `/privacy`, terms `/terms` (owner).
