import { savePushSubscription, deletePushSubscription } from '../api-client';

// Standard VAPID key conversion: the server hands us a URL-safe base64 public key;
// PushManager.subscribe wants it as a raw Uint8Array.
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// iOS Safari only exposes the Push API to an installed (standalone) PWA, never to a
// plain browser tab — so an iOS user who hasn't installed yet needs Add-to-Home-Screen
// guidance instead of an Enable button that can't work.
export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
}

function toSubscriptionJson(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw new Error('Incomplete push subscription');
  return { endpoint, keys: { p256dh, auth } };
}

// Must be called synchronously from a user-gesture handler (click) — on iOS Safari,
// Notification.requestPermission() called from a useEffect or after an await silently
// resolves to 'default' forever, never showing the native prompt.
export async function subscribeToPush(token: string, lang: 'uk' | 'en'): Promise<void> {
  if (!pushSupported()) throw new Error('Push not supported');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(`Permission ${permission}`);
  const registration = await navigator.serviceWorker.ready;
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  await savePushSubscription(token, toSubscriptionJson(subscription), lang);
}

// Called once on auth (permission already granted from a prior subscribe) to keep the
// server's copy of the subscription fresh — re-subscribing is a no-op if the browser's
// existing subscription is still valid, and re-POSTs it so the row's TTL is refreshed.
export async function refreshPushSubscription(token: string, lang: 'uk' | 'en'): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }
  await savePushSubscription(token, toSubscriptionJson(subscription), lang);
}

export async function unsubscribeFromPush(token: string): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await deletePushSubscription(token, endpoint);
}
