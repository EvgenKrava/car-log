# PWA Install Prompt (Add to Home Screen) — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** the deployed CarLog web app (Vite + React + MUI SPA on S3 + CloudFront)

## Goal

Make CarLog an installable PWA and show mobile users a custom, dismissible
pop-up to add it to their home screen. On Android/Chromium the pop-up triggers
the native install via `beforeinstallprompt`; on iOS Safari (no install API) it
shows manual "Share → Add to Home Screen" instructions. Frontend-only — no
backend, contracts, domain, or CDK changes (one small `deploy-web.sh` tweak for
service-worker cache headers).

## Locked Decisions

| Area | Decision |
|------|----------|
| Scope | Full PWA: web manifest + service worker + custom install prompt with iOS fallback |
| SW strategy | App-shell precache only (via vite-plugin-pwa / Workbox `generateSW`); NEVER cache API or auth requests |
| Prompt UX | Dismissible bottom banner, shown post-login on eligible devices; dismissal remembered in localStorage (no nagging) |
| Icons | Generate simple monogram icons now (brand blue `#1565c0`), authored as SVG and rasterized to PNG |
| Build strategy | Approach A — `vite-plugin-pwa` with `generateSW` + a hand-written `InstallPrompt` React component |

## Layer 1 — Icons + manifest

**Icons** — author one SVG monogram (white glyph on brand blue `#1565c0`),
rasterize with `rsvg-convert` (confirmed available; `sips` as fallback) as a
one-time authoring step, committed to the repo:

```
apps/web/public/icons/icon.svg               source (committed, regenerable)
apps/web/public/icons/icon-192.png           192x192, purpose "any"
apps/web/public/icons/icon-512.png           512x512, purpose "any"
apps/web/public/icons/icon-maskable-512.png  512x512, ~10% safe-zone padding, purpose "maskable"
apps/web/public/apple-touch-icon.png         180x180, iOS home-screen icon
```

Rasterization command (run once, not part of `vite build`):
`rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png` (and equivalents).

**Manifest** — configured in `vite.config.ts` via the plugin's `manifest`
block (plugin emits `manifest.webmanifest` and injects the `<link>`):

```
name: "CarLog"
short_name: "CarLog"
description: "Your vehicle maintenance log"
start_url: "/"
scope: "/"
display: "standalone"
theme_color: "#1565c0"
background_color: "#ffffff"
icons: [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
]
```

`index.html` also gets `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`
and `<meta name="theme-color" content="#1565c0">` (iOS ignores the manifest for
the icon, so these are required for a good iOS result).

## Layer 2 — vite-plugin-pwa + service worker

Add `vite-plugin-pwa` (dev dependency) to `apps/web`, configured in
`vite.config.ts`:

```ts
VitePWA({
  registerType: 'autoUpdate',
  manifest: { /* Layer 1 */ },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/callback/],
    // No runtimeCaching → API (execute-api) + Cognito always hit the network.
  },
  devOptions: { enabled: false },
})
```

Safety points:
- **App-shell precache only** — no `runtimeCaching`, so `GET /cars`, Cognito
  token calls, and all cross-origin requests bypass the SW and always go to
  network. No stale/other-user data after logout.
- **`autoUpdate`** — Workbox `registerSW` with immediate activation; a redeploy's
  new hashed assets are picked up on next visit. No custom update UI (YAGNI).
- **`navigateFallbackDenylist` for `/callback`** — the OAuth redirect route is
  never served the cached shell.
- **`devOptions.enabled: false`** — no SW during `vite dev`.

**CloudFront cache headers (`deploy-web.sh` change):** `sw.js` and
`manifest.webmanifest` must be uploaded with `Cache-Control: no-cache` so
clients don't get stuck on a stale service worker; hashed `assets/*` stay
long-cached. Implement by syncing those two files in a second `aws s3 cp` pass
with an explicit `--cache-control` after the main `aws s3 sync`.

## Layer 3 — InstallPrompt component

New `apps/web/src/components/InstallPrompt.tsx`, rendered once in the
authenticated area (post-login only). Split into a hook + a dumb view:

**`usePwaInstall()` hook** returns `{ mode, promptInstall, dismiss }`:
- On mount: add a `beforeinstallprompt` listener, `preventDefault()`, stash the
  event; add an `appinstalled` listener that dismisses.
- `mode: 'android' | 'ios' | 'none'` derived from a pure helper (Layer 4):
  - `android` — a captured `beforeinstallprompt` event exists.
  - `ios` — iOS Safari (UA match) and not already standalone.
  - `none` — already installed/standalone, dismissed, or unsupported/desktop.
- `promptInstall()` — calls the stashed event's `prompt()` (Android); awaits
  `userChoice`; dismisses on completion.
- `dismiss()` — sets `localStorage['carlog.pwa.dismissed'] = '1'` and hides.

**`InstallPrompt` view** — renders nothing when `mode === 'none'`. Otherwise an
MUI bottom banner (mobile-first `Paper`/`Snackbar`) "Install CarLog for quick
access":
- `android` → **Install** button (calls `promptInstall`) + **Not now** (dismiss).
- `ios` → instruction text "Tap the Share icon, then 'Add to Home Screen'." +
  **Got it** (dismiss).

**Already-installed check:** `window.matchMedia('(display-mode: standalone)').matches`
or iOS `navigator.standalone` → `none`.

**Mount point:** in `main.tsx`, rendered inside the router alongside the routes
so it overlays Garage/Vehicle. It self-suppresses on `none`, so it does not need
to be excluded from `/callback` (that route resolves to `none`: no prompt event
yet and not iOS-add context) — but keep it out of the `/callback` element to be
safe, mounting it in the authenticated layout area.

## Layer 4 — Types + testing

**Types** — `beforeinstallprompt` is not in the standard TS DOM lib. Add a
minimal declaration (`apps/web/src/types/pwa.d.ts`):

```ts
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
interface WindowEventMap { beforeinstallprompt: BeforeInstallPromptEvent; }
```

No `any`.

**Pure decision helper (the testable unit):**

```ts
type InstallMode = 'android' | 'ios' | 'none';
function resolveInstallMode(input: {
  hasPromptEvent: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  dismissed: boolean;
}): InstallMode;
```

Rules: `dismissed || isStandalone → 'none'`; else `hasPromptEvent → 'android'`;
else `isIOS → 'ios'`; else `'none'`.

**Tests** — add a minimal `vitest` config + dep to `apps/web` (currently none),
with a suite for `resolveInstallMode`:
- dismissed → none
- standalone → none
- iOS, not standalone, not dismissed → ios
- has prompt event → android
- plain desktop (no event, not iOS) → none

The React component and SW wiring are covered by static gates (typecheck + lint
+ build) and the live smoke test.

## Verification (definition of done)

After a web-only deploy (backend untouched):

1. Desktop Chrome (deployed HTTPS): DevTools → Application → Manifest shows
   CarLog + icons, no errors; Service Worker registered & activated; Lighthouse
   PWA "installable" ✓.
2. Network tab: `GET /cars` and Cognito calls hit the network (not SW cache).
3. Android Chrome: banner appears post-login → Install → app installs with the
   CarLog icon.
4. iOS Safari: banner shows Share → Add instructions; adding produces the
   apple-touch-icon.
5. Dismiss → reload → banner does not reappear.

## Scope Guard (YAGNI)

Out of scope: offline data caching, runtime API caching, push notifications,
update-available UI, background sync.

## Files

```
apps/web/public/icons/icon.svg               CREATE  source monogram
apps/web/public/icons/icon-192.png           CREATE  (rasterized)
apps/web/public/icons/icon-512.png           CREATE
apps/web/public/icons/icon-maskable-512.png  CREATE
apps/web/public/apple-touch-icon.png         CREATE
apps/web/index.html                          MODIFY  apple-touch-icon + theme-color meta
apps/web/vite.config.ts                      MODIFY  add VitePWA plugin + manifest + workbox
apps/web/package.json                        MODIFY  + vite-plugin-pwa, vitest (dev deps) + test script
apps/web/vitest.config.ts                    CREATE  minimal vitest config
apps/web/src/types/pwa.d.ts                  CREATE  BeforeInstallPromptEvent type
apps/web/src/lib/install-mode.ts             CREATE  resolveInstallMode pure helper
apps/web/src/lib/install-mode.test.ts        CREATE  vitest suite
apps/web/src/components/InstallPrompt.tsx    CREATE  hook + banner view
apps/web/src/main.tsx                        MODIFY  mount InstallPrompt in authed area
scripts/deploy-web.sh                        MODIFY  no-cache headers for sw.js + manifest
```
