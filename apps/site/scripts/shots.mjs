// Opens a headed Chromium with a persistent profile. Set CAR_URL to a car you want on the
// landing page, run this script, then sign in with email/password in that window (Google
// blocks automated browsers) — the script waits (up to 10 minutes) until you're past /login.
// It then captures every route at phone + desktop, light + dark, into src/assets/shots/.
// Nothing about your session is stored in the repo.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const CAR_URL = process.env.CAR_URL;
if (!CAR_URL) {
  console.error('Set CAR_URL=https://carlog.onlytools.click/cars/<id>');
  process.exit(1);
}

const ORIGIN = process.env.SITE_ORIGIN ?? 'https://carlog.onlytools.click';
const OUT = new URL('../src/assets/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext('/tmp/carlog-shots-profile', { headless: false, viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto(`${ORIGIN}/login`);
await page.waitForURL((u) => !u.pathname.startsWith('/login') && !u.pathname.startsWith('/callback'), { timeout: 600_000 });

const SIZES = { phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }, desktop: { width: 1280, height: 800, deviceScaleFactor: 2 } };
const ROUTES = { garage: `${ORIGIN}/garage`, timeline: CAR_URL.trim(), reminders: `${CAR_URL.trim()}?tab=reminders` };

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
