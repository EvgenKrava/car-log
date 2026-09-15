// Uses the machine's installed Google Chrome — Playwright's own Chromium download is blocked
// on some networks, this repo's included. Override with PW_CHANNEL=chromium (or another
// installed channel) if you have Playwright's browser installed and prefer it.
//
// Run this script, then sign in with the email + password form in the window that opens —
// NOT the "Continue with Google" button, which loops forever in an automation-controlled
// browser (Google blocks OAuth there). The script waits (up to 10 minutes) until you're back
// on our own origin, signed in. By default it then opens /garage and captures the first car
// it finds; set CAR_URL to a specific car's URL to capture that one instead (CAR_URL=first is
// the same as leaving it unset). It captures every route at phone + desktop, light + dark,
// into src/assets/shots/.
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

let carUrl;

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
    await signInPage.waitForURL((u) => u.origin === ORIGIN && (u.pathname === '/garage' || u.pathname.startsWith('/cars/')), { timeout: 600_000 });

    const requested = process.env.CAR_URL?.trim();
    if (requested && requested.toLowerCase() !== 'first') {
      carUrl = requested;
    } else {
      await signInPage.goto(`${ORIGIN}/garage`);
      const carLink = await signInPage.waitForSelector('a[href^="/cars/"]', { timeout: 60_000 });
      const href = await carLink.getAttribute('href');
      carUrl = new URL(href, ORIGIN).toString();
    }
    console.log('using car', carUrl);

    await signInCtx.storageState({ path: STATE_PATH });
  } finally {
    await signInCtx.close();
  }

  // Capture: headless, one browser + one context per size so viewport/deviceScaleFactor/
  // isMobile apply correctly (phone shots come out 780×1688px, desktop 2560×1600px).
  const SIZES = { phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }, desktop: { width: 1280, height: 800, deviceScaleFactor: 2, isMobile: false } };
  const ROUTES = { garage: `${ORIGIN}/garage`, timeline: carUrl, reminders: `${carUrl}?tab=reminders` };

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
} finally {
  rmSync(STATE_PATH, { force: true });
}
