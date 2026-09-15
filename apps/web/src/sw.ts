/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';
import { APP_ROUTES } from './lib/app-routes';
import { GARAGE_PATH } from './lib/paths';

declare const self: ServiceWorkerGlobalScope;

// Replicates the previous generateSW behavior (precache, immediate activation, SPA
// navigation fallback, no API caching) and adds the push handlers generateSW can't carry.
self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// Only app navigations get the SPA shell; marketing URLs fall through to the network so
// installed-PWA users still see the static pages.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/app.html'), { allowlist: APP_ROUTES }));

self.addEventListener('push', (event) => {
  // With userVisibleOnly: true, every push MUST result in a visible notification —
  // skip that contract (by returning without calling showNotification inside
  // waitUntil) and the browser shows its own generic "site updated in background"
  // notification and penalizes the push budget. event.data.json() also throws
  // SYNCHRONOUSLY (before waitUntil) on malformed JSON, which would abort the
  // listener entirely — so both the missing-payload and bad-JSON cases fall back
  // to a minimal generic notification instead of returning silently.
  let payload: { title: string; body: string; url: string } | undefined;
  if (event.data) {
    try {
      payload = event.data.json() as { title: string; body: string; url: string };
    } catch {
      payload = undefined;
    }
  }
  const title = payload?.title ?? 'CarLog';
  const body = payload?.body;
  const url = payload?.url ?? GARAGE_PATH;
  event.waitUntil(self.registration.showNotification(title, {
    body, data: { url }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? GARAGE_PATH;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((c) => 'focus' in c);
    if (existing) { await existing.navigate(url); await existing.focus(); return; }
    await self.clients.openWindow(url);
  })());
});
