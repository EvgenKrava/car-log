# Web Push Notifications — Stale Mileage + Due Reminders

**Date:** 2026-08-07
**Status:** Approved

## Goal

OS-level push notifications for the installed PWA: nudge the owner when a car's odometer
hasn't been updated in 7+ days ("if user logged in and his miles was updated more than a
week ago" — generalized to fire even without opening the app), and when reminders become
due. Tapping the mileage push opens a **quick odometer sheet** — two taps from lock
screen to saved.

## Decisions taken (confirmed 2026-08-07)

- Real Web Push (not in-app-only nudge). iOS 16.4+ installed PWA requirement accepted.
- v1 fires TWO notification types: stale mileage (7+ days) and due reminders
  (overdue/due_soon via existing `reminderStatus`).

## Technical constraints discovered up front

1. **The PWA currently builds its service worker in `generateSW` mode** (vite-plugin-pwa)
   — no SW source file exists. Push needs custom handlers, so the build switches to
   **`injectManifest`** with a new `apps/web/src/sw.ts` that (a) preserves precaching via
   `precacheAndRoute(self.__WB_MANIFEST)` + the existing runtime-caching equivalents, and
   (b) adds `push` and `notificationclick` handlers. The existing gates (sw.js must
   contain 0 `execute-api` references) must keep passing.
2. **`Car.updatedAt` is not a mileage-staleness signal** (bumps on any edit). Add
   **`mileageUpdatedAt: z.string().datetime()`** to `CarSchema`, set wherever `mileage`
   changes: car create, car update WHEN the submitted mileage differs, `bumpCarMileage`
   consumers (event create/update, reminder completion), and car import. Legacy rows:
   normalize at the Dynamo read boundary (`mileageUpdatedAt ?? updatedAt` — same pattern
   as the chat `actions ?? []` backfill). The web's car parsing must default it too
   (`.default()` is not possible for a required datetime derived from a sibling — instead
   the contract makes it OPTIONAL with the read boundary always filling it; the API never
   returns it absent).

## Backend

### Subscriptions

- `PushSubscriptionSchema` (contracts): `{ endpoint: url, keys: { p256dh, auth } }` —
  the browser's `PushSubscription.toJSON()` shape.
- Routes: `POST /push/subscription` (upsert; body = subscription JSON; row keyed
  `PK=USER#<sub>`, `SK=PUSH#<sha256(endpoint) hex, first 32>`; TTL 180 days, refreshed on
  every POST) and `DELETE /push/subscription` (body = `{ endpoint }`).
- The row also carries `lastNotified: Record<string, string>` — a map of
  `<carId>#<type>` → ISO date, the dedupe memory (see cadence).

### VAPID + sending

- `web-push` npm dependency in `apps/api` (bundled via `nodeModules` — REMEMBER the
  Transcribe SDK bundling lesson: verify the synthed asset contains it before deploy).
- VAPID keypair generated once (`npx web-push generate-vapid-keys`), stored in SSM
  Parameter Store; private key resolved at synth into a Lambda env var (same mechanism as
  the Bedrock bearer token); public key exported as a stack output → `deploy-web.sh`
  writes it into `.env.production` as `VITE_VAPID_PUBLIC_KEY`.

### Notify worker

- EventBridge rule: cron 07:00 UTC daily → invokes the existing CarsFn with
  `{ jobType: 'notify' }` (same detached self-invoke pattern as the import worker; the
  handler already branches on payload type).
- Worker (`apps/api/src/notify-worker.ts`, pure logic separated from I/O for tests):
  scan push-subscription rows → group by user → for each user's cars:
  - **stale-mileage**: `today - mileageUpdatedAt > 7 days` → push type `mileage`.
  - **reminders**: any reminder `overdue`/`due_soon` (existing `reminderStatus`, injected
    `today`) → ONE push type `reminders` per car listing the nearest item.
  - **Cadence/dedupe**: at most one push per `<carId>#<type>` per calendar day; while a
    condition persists, re-notify only every 7 days (`lastNotified` map decides). The
    map is pruned of entries whose condition cleared.
  - Payload: `{ title, body, url }` — mileage: title `🚗 <car name>`, body localized
    "odometer not updated in N days", url `/cars/<id>?odometer=1`; reminders: title
    `🔧 <reminder title>`, body "due in X km / X days" (reuse the reminder card's anchor
    strings), url `/cars/<id>?tab=reminders`.
  - **Language**: the subscription row stores `lang: 'uk' | 'en'` captured at subscribe
    time from the app locale; worker renders strings from a small server-side copy table
    (no i18n framework server-side — a two-language constant map).
  - 404/410 from the push service → delete the subscription row.
  - Time budget: same `remainingMs` guard pattern as the import worker.

## Web

### Service worker (`apps/web/src/sw.ts`)

- `precacheAndRoute(self.__WB_MANIFEST)`; replicate the current generateSW config
  (navigation fallback, the existing `navigateFallbackDenylist`/runtime rules — read
  vite.config.ts and port them).
- `push` event → `showNotification(title, { body, data: { url }, icon, badge })`.
- `notificationclick` → focus an existing client on that URL or `openWindow`.

### Subscription flow

- `apps/web/src/lib/push.ts`: `subscribeToPush(token)` — `Notification.requestPermission()`
  → `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
  → POST to the API; `unsubscribeFromPush(token)`. Re-POST the current subscription on
  app open when permission is already granted (TTL refresh + endpoint rotation safety).
- **Permission UX — never prompt on load:**
  - Profile page: an "Enable notifications" card (bell icon, one-line value prop,
    Enable button; hidden when subscribed or denied; "denied" state shows how to
    re-enable in settings).
  - One-time contextual prompt: after the user completes a reminder (a moment of
    demonstrated engagement), a snackbar offers enabling notifications. Shown once ever
    (localStorage flag).
  - iOS in browser tab (not installed): the card explains Add to Home Screen first
    (detect via `!window.matchMedia('(display-mode: standalone)')` + iOS UA).

### Quick odometer sheet

- `QuickOdometerSheet` (Modal-based bottom sheet): current mileage pre-filled in a large
  numeric field, `+50 +100 +500` chips increment it, Save → existing car-update mutation
  (full `CreateCarInput` built from the loaded car + new mileage — same as the executor's
  merge approach). Opens from (a) `?odometer=1` on the Vehicle page (the push deep link;
  param cleared after open), (b) tapping the odometer stat tile in the hero.
- Guard: warn inline (non-blocking) when the entered value is LOWER than current.

## CDK

- EventBridge `Rule` (cron `0 7 * * ? *`) → CarsFn (self-invoke permission exists).
- Lambda env: `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (mailto).
- Stack output `VapidPublicKey`; `deploy-web.sh` writes `VITE_VAPID_PUBLIC_KEY`.
- Routes: `POST /push/subscription`, `DELETE /push/subscription` (JWT).
- Bundling: `nodeModules: [..., 'web-push']` + asset verification before deploy.

## Testing

- Contracts: subscription schema; `mileageUpdatedAt` presence/optionality.
- Domain/API: `mileageUpdatedAt` set on every mileage-changing path (event create/update,
  reminder complete, car update with new mileage, import) — and NOT on a nickname-only
  update. Read-boundary backfill for legacy rows.
- Notify worker (pure fns + fakes): staleness window boundaries, per-day dedupe,
  7-day re-notify, condition-cleared pruning, 410 → row deleted, one-push-per-car-per-type,
  language selection, time-budget bail.
- Routes: subscribe upsert/refresh, delete, ownership.
- SW/web: gates only + live acceptance (the user receiving both push types on iPhone).

## Out of scope

- Notification preferences UI (mute per car/type) — v2.
- Chat/import-completion notifications.
- Android/desktop-specific notification actions (inline buttons).
