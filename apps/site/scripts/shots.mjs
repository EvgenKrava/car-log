// Uses the machine's installed Google Chrome — Playwright's own Chromium download is blocked
// on some networks, this repo's included. Override with PW_CHANNEL=chromium (or another
// installed channel) if you have Playwright's browser installed and prefer it.
//
// Run this script, then sign in with the email + password form in the window that opens —
// NOT the "Continue with Google" button, which loops forever in an automation-controlled
// browser (Google blocks OAuth there). The script waits (up to 10 minutes) until you're back
// on our own origin, signed in — wherever the app's own post-login redirect lands (the
// garage). By default it captures the first car it finds there; set CAR_URL to a specific
// car's URL to capture that one instead (CAR_URL=first is the same as leaving it unset). It
// captures every route at phone + desktop, light + dark, into src/assets/shots/.
//
// Sign-in happens in one headed, persistent-profile context (so Google sees a normal
// returning browser). Captures happen in separate headless contexts, one per size, built
// from that session's storage state — a page's deviceScaleFactor/isMobile can only be set at
// context-creation time, not via setViewportSize on an already-open page, so each size needs
// its own context. The storage state (session cookies/tokens) and the sign-in profile both
// live under the OS temp dir, outside the repo; the storage state is deleted when the script
// exits, and every browser/context is closed even if a step fails partway through.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.env.SITE_ORIGIN ?? 'https://carlog.onlytools.click';
const CHANNEL = process.env.PW_CHANNEL ?? 'chrome';
const OUT = new URL('../src/assets/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const STATE_PATH = join(tmpdir(), `carlog-shots-state-${process.pid}.json`);
const PROFILE_DIR = join(tmpdir(), 'carlog-shots-profile');
// Pages the app can be on mid sign-in (including the auth-provider detour); anything else on
// our origin means signed in. Deliberately over-inclusive of routes that don't exist yet
// (/signup, /confirm, /forgot, /reset) so this doesn't need to change if they're added.
const AUTH_PATHS = ['/login', '/signup', '/confirm', '/forgot', '/reset', '/callback'];

let carUrl;
let garageUrl;

try {
  // Sign in: headed, persistent profile so Google treats it as a normal browser.
  const signInCtx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: CHANNEL,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const signInPage = await signInCtx.newPage();
    await signInPage.goto(`${ORIGIN}/login`);
    // Wait for an authenticated page on OUR origin specifically — leaving /login for
    // accounts.google.com (via "Continue with Google") is not signed in, it's Google looping
    // on the automated browser. Keep waiting through any such detour until the owner comes
    // back and signs in with email + password instead.
    await signInPage.waitForURL((u) => u.origin === ORIGIN && !AUTH_PATHS.some((p) => u.pathname.startsWith(p)), { timeout: 600_000 });
    console.log('Signed in — capturing… keep this window open until "done" is printed');

    // The app's own post-login redirect already lands on the garage — today at `/`, a later
    // task moves it to `/garage` — so stay put rather than navigating, and use this URL for
    // the `garage` route capture below instead of a hardcoded path.
    garageUrl = signInPage.url();

    const requested = process.env.CAR_URL?.trim();
    if (requested && requested.toLowerCase() !== 'first') {
      carUrl = requested;
    } else {
      // Garage cards are MUI CardActionArea buttons (onClick navigation), not <a> tags — no
      // href to read, so click the first one and read the resulting URL instead.
      const card = signInPage.locator('.MuiCardActionArea-root').first();
      await card.waitFor({ state: 'visible', timeout: 60_000 });
      await card.click();
      await signInPage.waitForURL((u) => u.origin === ORIGIN && u.pathname.startsWith('/cars/'), { timeout: 60_000 });
      carUrl = signInPage.url().split('?')[0];
    }
    console.log('using car', carUrl);

    await signInCtx.storageState({ path: STATE_PATH });
  } finally {
    await signInCtx.close();
  }

  // Capture: headless, one browser + one context per size so viewport/deviceScaleFactor/
  // isMobile apply correctly (phone shots come out 780×1688px, desktop 2560×1600px).
  const SIZES = { phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }, desktop: { width: 1280, height: 800, deviceScaleFactor: 2, isMobile: false } };
  const ROUTES = { garage: garageUrl, timeline: carUrl, reminders: `${carUrl}?tab=reminders` };

  for (const [sizeName, size] of Object.entries(SIZES)) {
    const browser = await chromium.launch({ headless: true, channel: CHANNEL });
    try {
      for (const scheme of ['light', 'dark']) {
        const ctx = await browser.newContext({
          storageState: STATE_PATH,
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: size.deviceScaleFactor,
          isMobile: size.isMobile,
          colorScheme: scheme,
        });
        const p = await ctx.newPage();
        for (const [routeName, url] of Object.entries(ROUTES)) {
          await p.goto(url, { waitUntil: 'networkidle' });
          await p.waitForTimeout(800);
          await p.screenshot({ path: `${OUT}${routeName}-${sizeName}-${scheme}.png`, fullPage: false });
          console.log('saved', `${routeName}-${sizeName}-${scheme}.png`);
        }
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
  console.log('done');
} finally {
  rmSync(STATE_PATH, { force: true });
}
