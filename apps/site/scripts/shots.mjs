// Uses the machine's installed Google Chrome — Playwright's own Chromium download is blocked
// on some networks, this repo's included. Override with PW_CHANNEL=chromium (or another
// installed channel) if you have Playwright's browser installed and prefer it.
//
// Set CAR_URL to a car you want on the landing page, run this script, then sign in with
// email/password in the window that opens (Google blocks automated browsers) — the script
// waits (up to 10 minutes) until you're past /login. It then captures every route at
// phone + desktop, light + dark, into src/assets/shots/.
//
// Sign-in happens in one headed, persistent-profile context (so Google sees a normal
// returning browser). Captures happen in separate headless contexts, one per size, built
// from that session's storage state — a page's deviceScaleFactor/isMobile can only be set at
// context-creation time, not via setViewportSize on an already-open page, so each size needs
// its own context. The storage state (session cookies/tokens) is written to a temp file
// outside the repo and deleted at the end; nothing about your session is stored in the repo.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CAR_URL = process.env.CAR_URL;
if (!CAR_URL) {
  console.error('Set CAR_URL=https://carlog.onlytools.click/cars/<id>');
  process.exit(1);
}

const ORIGIN = process.env.SITE_ORIGIN ?? 'https://carlog.onlytools.click';
const CHANNEL = process.env.PW_CHANNEL ?? 'chrome';
const OUT = new URL('../src/assets/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const STATE_PATH = join(tmpdir(), `carlog-shots-state-${process.pid}.json`);

try {
  // Sign in: headed, persistent profile so Google treats it as a normal browser.
  const signInCtx = await chromium.launchPersistentContext('/tmp/carlog-shots-profile', {
    headless: false,
    channel: CHANNEL,
    viewport: { width: 1280, height: 800 },
  });
  const signInPage = await signInCtx.newPage();
  await signInPage.goto(`${ORIGIN}/login`);
  await signInPage.waitForURL((u) => !u.pathname.startsWith('/login') && !u.pathname.startsWith('/callback'), { timeout: 600_000 });
  await signInCtx.storageState({ path: STATE_PATH });
  await signInCtx.close();

  // Capture: headless, one browser + one context per size so viewport/deviceScaleFactor/
  // isMobile apply correctly (phone shots come out 780×1688px, desktop 2560×1600px).
  const SIZES = { phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }, desktop: { width: 1280, height: 800, deviceScaleFactor: 2, isMobile: false } };
  const ROUTES = { garage: `${ORIGIN}/garage`, timeline: CAR_URL.trim(), reminders: `${CAR_URL.trim()}?tab=reminders` };

  for (const [sizeName, size] of Object.entries(SIZES)) {
    const browser = await chromium.launch({ headless: true, channel: CHANNEL });
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
    await browser.close();
  }
} finally {
  rmSync(STATE_PATH, { force: true });
}
