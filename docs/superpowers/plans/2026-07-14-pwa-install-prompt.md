# PWA Install Prompt (Add to Home Screen) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CarLog an installable PWA (manifest + app-shell service worker) and show mobile users a dismissible custom pop-up to add it to their home screen — native install on Android/Chromium, Share→Add instructions on iOS Safari.

**Architecture:** Frontend-only. `vite-plugin-pwa` (Workbox `generateSW`) emits the manifest + app-shell-precache service worker (no API/auth caching). A hand-written `InstallPrompt` component (hook + MUI bottom banner) drives the UX off a pure `resolveInstallMode` helper. Monogram icons authored as SVG, rasterized to PNG. One `deploy-web.sh` tweak sets `no-cache` on the SW/manifest.

**Tech Stack:** Vite 5.4, React 18, TypeScript (strict), MUI v6, `vite-plugin-pwa` (v0.20.x — the line compatible with Vite 5), Vitest v2, Workbox (via the plugin). `rsvg-convert` for icon rasterization (dev-machine tool, confirmed present).

## Global Constraints

- Strict TypeScript, never `any`. Prefer `type`; `interface` only for service abstractions (a DOM event `interface` for `BeforeInstallPromptEvent` is fine — it augments lib types).
- Extensionless relative imports (`moduleResolution: "bundler"`).
- MUI only, mobile-first.
- Frontend-only — no backend, contracts, domain, or CDK changes. Only `apps/web/**` and `scripts/deploy-web.sh`.
- **Service worker caches the app shell only** — NO `runtimeCaching`. API (`execute-api`) and Cognito requests must always hit the network.
- `vite-plugin-pwa` must be the **v0.20.x** line (compatible with Vite 5.4); do not install v1/v0.21+ which require Vite 6/7.
- Manifest identity: name/short_name `"CarLog"`, `theme_color` `#1565c0`, `background_color` `#ffffff`, `display: "standalone"`, `start_url`/`scope` `/`.
- localStorage dismissal key: exactly `carlog.pwa.dismissed` (value `'1'`).
- Conventional commits; NO co-authorship trailers.
- Verification is web-only deploy via `scripts/deploy-web.sh` — NO backend redeploy.

## File Structure

```
apps/web/public/icons/icon.svg               CREATE  source monogram (committed)
apps/web/public/icons/icon-192.png           CREATE  rasterized 192, purpose any
apps/web/public/icons/icon-512.png           CREATE  rasterized 512, purpose any
apps/web/public/icons/icon-maskable-512.png  CREATE  512 with safe-zone padding, maskable
apps/web/public/apple-touch-icon.png         CREATE  180x180 iOS icon
apps/web/index.html                          MODIFY  apple-touch-icon + theme-color meta
apps/web/src/types/pwa.d.ts                  CREATE  BeforeInstallPromptEvent declaration
apps/web/src/lib/install-mode.ts             CREATE  resolveInstallMode pure helper
apps/web/src/lib/install-mode.test.ts        CREATE  vitest suite (web's first tests)
apps/web/vitest.config.ts                    CREATE  minimal vitest config
apps/web/package.json                        MODIFY  + vite-plugin-pwa, vitest devDeps; + test script
apps/web/vite.config.ts                      MODIFY  add VitePWA plugin (manifest + workbox)
apps/web/src/components/InstallPrompt.tsx    CREATE  usePwaInstall hook + banner view
apps/web/src/main.tsx                        MODIFY  mount <InstallPrompt/> in authed area
scripts/deploy-web.sh                        MODIFY  no-cache headers for sw.js + manifest
```

Task order: pure logic + tests first (Task 1), then types/icons/config (Tasks 2–3), then the component (Task 4), then deploy-script + verification (Task 5).

---

### Task 1: `resolveInstallMode` pure helper + Vitest setup

**Files:**
- Modify: `apps/web/package.json` (add `vitest` devDep + `test` script)
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/lib/install-mode.ts`
- Test: `apps/web/src/lib/install-mode.test.ts`

**Interfaces:**
- Produces:
  - `type InstallMode = 'android' | 'ios' | 'none'`
  - `resolveInstallMode(input: { hasPromptEvent: boolean; isIOS: boolean; isStandalone: boolean; dismissed: boolean }): InstallMode`

- [ ] **Step 1: Add vitest devDep + test script to `apps/web/package.json`**

In `devDependencies` add `"vitest": "^2.1.1"` (matches the version used in `packages/contracts`). In `scripts` add `"test": "vitest run"`. Leave all other fields unchanged.

- [ ] **Step 2: Install so vitest resolves**

Run: `pnpm install`
Expected: completes; `vitest` linked into `apps/web`.

- [ ] **Step 3: Create `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 4: Write the failing test — `apps/web/src/lib/install-mode.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { resolveInstallMode } from './install-mode';

const base = { hasPromptEvent: false, isIOS: false, isStandalone: false, dismissed: false };

describe('resolveInstallMode', () => {
  it('returns none when already dismissed', () => {
    expect(resolveInstallMode({ ...base, dismissed: true, hasPromptEvent: true })).toBe('none');
  });

  it('returns none when running standalone (already installed)', () => {
    expect(resolveInstallMode({ ...base, isStandalone: true, hasPromptEvent: true })).toBe('none');
  });

  it('returns android when a prompt event is captured', () => {
    expect(resolveInstallMode({ ...base, hasPromptEvent: true })).toBe('android');
  });

  it('returns ios on iOS Safari that is not standalone', () => {
    expect(resolveInstallMode({ ...base, isIOS: true })).toBe('ios');
  });

  it('returns none on plain desktop (no event, not iOS)', () => {
    expect(resolveInstallMode(base)).toBe('none');
  });

  it('prefers android over ios when both a prompt event and iOS are somehow present', () => {
    expect(resolveInstallMode({ ...base, hasPromptEvent: true, isIOS: true })).toBe('android');
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @carlog/web test`
Expected: FAIL — cannot resolve `./install-mode`.

- [ ] **Step 6: Create `apps/web/src/lib/install-mode.ts`**

```ts
export type InstallMode = 'android' | 'ios' | 'none';

export type InstallModeInput = {
  hasPromptEvent: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  dismissed: boolean;
};

export function resolveInstallMode({
  hasPromptEvent, isIOS, isStandalone, dismissed,
}: InstallModeInput): InstallMode {
  if (dismissed || isStandalone) return 'none';
  if (hasPromptEvent) return 'android';
  if (isIOS) return 'ios';
  return 'none';
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @carlog/web test`
Expected: PASS (6 tests).

- [ ] **Step 8: Typecheck + lint**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint`
Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json apps/web/vitest.config.ts apps/web/src/lib/install-mode.ts apps/web/src/lib/install-mode.test.ts pnpm-lock.yaml
git commit -m "feat(web): add resolveInstallMode helper and vitest setup"
```

---

### Task 2: PWA type declaration + icons + index.html meta

**Files:**
- Create: `apps/web/src/types/pwa.d.ts`
- Create: `apps/web/public/icons/icon.svg`
- Create (rasterized): `apps/web/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apps/web/public/apple-touch-icon.png`
- Modify: `apps/web/index.html`

**Interfaces:**
- Produces: global `BeforeInstallPromptEvent` type and `WindowEventMap['beforeinstallprompt']` augmentation; the icon asset files at the paths the manifest (Task 3) references.

- [ ] **Step 1: Create `apps/web/src/types/pwa.d.ts`**

```ts
export {};

declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    prompt(): Promise<void>;
    readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  }
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
}
```

- [ ] **Step 2: Create the source monogram `apps/web/public/icons/icon.svg`**

A 512×512 rounded-square brand-blue tile with a white "C". This is the "any" full-bleed art:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1565c0"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-weight="700"
        font-size="300" fill="#ffffff">C</text>
</svg>
```

- [ ] **Step 3: Create a maskable source `apps/web/public/icons/icon-maskable.svg`**

Same tile but the glyph shrunk into the maskable safe zone (~80% center) so Android's mask can't clip it; full-bleed blue background:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1565c0"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-weight="700"
        font-size="230" fill="#ffffff">C</text>
</svg>
```

- [ ] **Step 4: Rasterize the PNGs with `rsvg-convert`**

Run:
```bash
cd apps/web/public/icons
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 512 -h 512 icon-maskable.svg -o icon-maskable-512.png
rsvg-convert -w 180 -h 180 icon.svg -o ../apple-touch-icon.png
cd -
```
Expected: four PNG files created. Verify with `file apps/web/public/icons/icon-192.png` → "PNG image data, 192 x 192".

(If `rsvg-convert` is unavailable, fall back to `sips`: `sips -s format png -z 192 192 icon.svg --out icon-192.png` — but `rsvg-convert` is confirmed present.)

- [ ] **Step 5: Add icon + theme-color meta to `apps/web/index.html`**

Replace the `<head>` block. Current head:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CarLog</title>
  </head>
```

with:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#1565c0" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>CarLog</title>
  </head>
```

- [ ] **Step 6: Typecheck (confirms the .d.ts is valid and picked up)**

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/types/pwa.d.ts apps/web/public/icons apps/web/public/apple-touch-icon.png apps/web/index.html
git commit -m "feat(web): add PWA icons, apple-touch-icon, and beforeinstallprompt types"
```

---

### Task 3: vite-plugin-pwa (manifest + app-shell service worker)

**Files:**
- Modify: `apps/web/package.json` (add `vite-plugin-pwa` devDep)
- Modify: `apps/web/vite.config.ts`

**Interfaces:**
- Consumes: the icon files from Task 2.
- Produces: at build time, `dist/manifest.webmanifest`, `dist/sw.js`, `dist/registerSW.js`, and the injected `<link rel="manifest">` + SW registration in `dist/index.html`.

- [ ] **Step 1: Add the plugin devDep to `apps/web/package.json`**

In `devDependencies` add `"vite-plugin-pwa": "^0.20.5"` (the v0.20 line is compatible with Vite 5.4; do NOT use v0.21+/v1 which need Vite 6/7).

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: completes; `vite-plugin-pwa` + its Workbox deps linked.

- [ ] **Step 3: Replace `apps/web/vite.config.ts`**

Current:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [react()] });
```

with:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'CarLog',
        short_name: 'CarLog',
        description: 'Your vehicle maintenance log',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#1565c0',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/callback/],
        // No runtimeCaching: API (execute-api) and Cognito always hit the network.
      },
      devOptions: { enabled: false },
    }),
  ],
});
```

- [ ] **Step 4: Build and verify the SW + manifest are emitted with correct content**

Run:
```bash
pnpm --filter @carlog/web build
ls apps/web/dist/sw.js apps/web/dist/manifest.webmanifest
grep -c 'execute-api' apps/web/dist/sw.js
```
Expected: `build` succeeds; both files exist; `grep -c execute-api` prints `0` (the SW must NOT reference the API — proves no runtime API caching). Also confirm `apps/web/dist/index.html` contains `rel="manifest"` (run `grep -c 'rel="manifest"' apps/web/dist/index.html` → `1`).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/vite.config.ts pnpm-lock.yaml
git commit -m "feat(web): configure vite-plugin-pwa with app-shell precache manifest"
```

---

### Task 4: InstallPrompt component (hook + banner)

**Files:**
- Create: `apps/web/src/components/InstallPrompt.tsx`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `resolveInstallMode`, `type InstallMode` from `../lib/install-mode` (Task 1); the `BeforeInstallPromptEvent` global type (Task 2).
- Produces: `export function InstallPrompt(): JSX.Element | null`.

- [ ] **Step 1: Create `apps/web/src/components/InstallPrompt.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { resolveInstallMode, type InstallMode } from '../lib/install-mode';

const DISMISS_KEY = 'carlog.pwa.dismissed';

const isIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);

function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => localStorage.getItem(DISMISS_KEY) === '1');
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setPromptEvent(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const mode: InstallMode = installed
    ? 'none'
    : resolveInstallMode({
        hasPromptEvent: promptEvent !== null,
        isIOS: isIOS(),
        isStandalone: isStandalone(),
        dismissed,
      });

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
    dismiss();
  }, [promptEvent, dismiss]);

  return { mode, promptInstall, dismiss };
}

export function InstallPrompt() {
  const { mode, promptInstall, dismiss } = usePwaInstall();

  if (mode === 'none') return null;

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: (t) => t.zIndex.snackbar,
        p: 2, borderRadius: 0,
      }}
    >
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1">Install CarLog for quick access</Typography>
          {mode === 'ios' ? (
            <Typography variant="body2" color="text.secondary">
              Tap the Share icon, then &ldquo;Add to Home Screen&rdquo;.
            </Typography>
          ) : null}
        </Box>
        <Stack direction="row" spacing={1}>
          {mode === 'android' ? (
            <Button variant="contained" onClick={() => void promptInstall()}>Install</Button>
          ) : null}
          <Button onClick={dismiss}>{mode === 'ios' ? 'Got it' : 'Not now'}</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
```

- [ ] **Step 2: Mount `<InstallPrompt/>` in `apps/web/src/main.tsx`**

Add the import after the route imports:

```ts
import { InstallPrompt } from './components/InstallPrompt';
```

Render it inside `<BrowserRouter>`, as a sibling AFTER `<Routes>`, so it overlays the app but is not part of any single route (it self-suppresses to `null` off-mode, including on `/callback` where no prompt event exists and it is not an iOS-add context). Change:

```tsx
          <BrowserRouter>
            <Routes>
              <Route path="/callback" element={<Callback />} />
              <Route path="/" element={<RequireAuth><Garage /></RequireAuth>} />
              <Route path="/cars/:id" element={<RequireAuth><Vehicle /></RequireAuth>} />
            </Routes>
          </BrowserRouter>
```

to:

```tsx
          <BrowserRouter>
            <Routes>
              <Route path="/callback" element={<Callback />} />
              <Route path="/" element={<RequireAuth><Garage /></RequireAuth>} />
              <Route path="/cars/:id" element={<RequireAuth><Vehicle /></RequireAuth>} />
            </Routes>
            <InstallPrompt />
          </BrowserRouter>
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint`
Expected: both PASS, no `any`.

- [ ] **Step 4: Build**

Run: `pnpm --filter @carlog/web build`
Expected: `vite build` succeeds, emits `apps/web/dist`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/InstallPrompt.tsx apps/web/src/main.tsx
git commit -m "feat(web): add InstallPrompt banner with Android prompt and iOS instructions"
```

---

### Task 5: Deploy-script cache headers + full verification

**Files:**
- Modify: `scripts/deploy-web.sh`

- [ ] **Step 1: Add no-cache re-upload for the SW + manifest in `scripts/deploy-web.sh`**

Current tail:

```bash
pnpm --filter @carlog/web build
aws s3 sync apps/web/dist "s3://$BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
echo "Deployed web to $WEB_URL"
```

Replace with:

```bash
pnpm --filter @carlog/web build
aws s3 sync apps/web/dist "s3://$BUCKET" --delete
# The service worker and manifest must never be edge-cached, or clients get stuck
# on a stale SW. Re-upload them with no-cache (hashed assets/* stay long-cached).
aws s3 cp apps/web/dist/sw.js "s3://$BUCKET/sw.js" \
  --cache-control "no-cache" --content-type "application/javascript"
aws s3 cp apps/web/dist/manifest.webmanifest "s3://$BUCKET/manifest.webmanifest" \
  --cache-control "no-cache" --content-type "application/manifest+json"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
echo "Deployed web to $WEB_URL"
```

- [ ] **Step 2: Shellcheck-style sanity (bash syntax parses)**

Run: `bash -n scripts/deploy-web.sh`
Expected: no output (syntax OK).

- [ ] **Step 3: Run all repo gates**

Run: `pnpm turbo run typecheck lint test`
Expected: all packages PASS — contracts 6, domain 2, api 6, and now `@carlog/web` runs its 6 `resolveInstallMode` tests (web was previously skipped in the test gate; the `test` script added in Task 1 makes it participate).

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy-web.sh
git commit -m "chore: serve service worker and manifest with no-cache headers"
```

- [ ] **Step 5: Deploy web (web-only, no backend redeploy)**

Run: `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`
Expected: builds, syncs, re-uploads sw.js/manifest with no-cache, invalidates CloudFront, prints `Deployed web to https://<cf-domain>`.

- [ ] **Step 6: Live smoke test (definition of done)**

On the deployed CloudFront URL:
1. Desktop Chrome, signed in: DevTools → Application → Manifest shows "CarLog" + the three icons, no errors; Service Worker is registered and activated; Lighthouse (or the address-bar install icon) reports the app installable.
2. Network tab: trigger a car list load and confirm `GET /cars` (execute-api) and the Cognito token calls show as network requests, NOT served from ServiceWorker.
3. Android Chrome: after login the bottom banner appears → tap Install → the native sheet installs CarLog with the monogram icon.
4. iOS Safari: the banner shows the "Tap Share → Add to Home Screen" instructions; adding uses the apple-touch-icon.
5. Tap "Not now"/"Got it" → reload → the banner does not reappear (localStorage `carlog.pwa.dismissed`).

Expected: all five pass.

---

## Self-Review Notes

- **Spec coverage:** Layer 1 icons+manifest → Tasks 2 (icons/meta) + 3 (manifest); Layer 2 plugin/SW → Task 3; Layer 3 InstallPrompt → Task 4; Layer 4 types → Task 2, testable helper + tests → Task 1; deploy cache headers → Task 5; verification → Task 5. All spec layers mapped.
- **Frontend-only:** every file is under `apps/web/**` except `scripts/deploy-web.sh` (allowed by the spec). No backend/contracts/domain/CDK changes.
- **Placeholder scan:** no TBD/TODO; every code step shows complete content; the icon SVGs, the plugin config, and the component are all full.
- **Type consistency:** `InstallMode`/`resolveInstallMode`/`InstallModeInput` (Task 1) used identically by `InstallPrompt` (Task 4); `BeforeInstallPromptEvent` (Task 2) used by the hook (Task 4); `DISMISS_KEY = 'carlog.pwa.dismissed'` matches the spec's exact key.
- **App-shell-only proof:** Task 3 Step 4 asserts `grep -c execute-api dist/sw.js == 0`, mechanically enforcing "no API caching".
- **Test-gate integration:** Task 1 adds the `test` script so `turbo run test` actually runs web's tests (previously skipped); Task 5 Step 3 confirms the full gate is green.
- **Version pin rationale:** `vite-plugin-pwa@^0.20.5` is the line compatible with the project's Vite 5.4 — stated in Global Constraints and Task 3 Step 1 so the implementer doesn't grab an incompatible v1.
