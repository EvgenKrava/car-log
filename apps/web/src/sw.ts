/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

// Replicates the previous generateSW behavior (precache, immediate activation, SPA
// navigation fallback, no API caching) and adds the push handlers generateSW can't carry.
self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const { title, body, url } = event.data.json() as { title: string; body: string; url: string };
  event.waitUntil(self.registration.showNotification(title, {
    body, data: { url }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((c) => 'focus' in c);
    if (existing) { await existing.navigate(url); await existing.focus(); return; }
    await self.clients.openWindow(url);
  })());
});
