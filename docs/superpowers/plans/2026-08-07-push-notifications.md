# Web Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily push notifications (stale odometer 7+ days; due reminders) to the installed PWA, with a tap-to-update quick odometer sheet.

**Architecture:** New `mileageUpdatedAt` car field (backfilled at the Dynamo read boundary); push-subscription rows under the user PK; a notify worker invoked by an EventBridge cron through the existing self-invoke pattern; `web-push` for VAPID sending; the PWA switches to `injectManifest` with a custom `sw.ts` carrying push handlers; permission UX on Profile + post-reminder-completion; deep link `?odometer=1` opens the quick sheet.

**Tech Stack:** `web-push` (api), vite-plugin-pwa `injectManifest`, EventBridge, SSM SecureString, MUI.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-07-push-notifications-design.md` is authoritative.
- Staleness = `today - mileageUpdatedAt > 7 days`. Cadence: max one push per `<carId>#<type>` per day; re-notify every 7 days while a condition persists; prune cleared conditions from `lastNotified`.
- **Never prompt for notification permission on page load.**
- `mileageUpdatedAt` changes ONLY when mileage changes. Legacy rows backfill `?? updatedAt` at the read boundary.
- **Bundling lesson (Transcribe incident): `web-push` must be in `bundling.nodeModules` and VERIFIED inside the synthed asset before deploy.**
- The built `sw.js` must still contain 0 `execute-api` references (deploy gate).
- Strict TS never `any`; no TODO/stubs; trailing newline; conventional commits NO trailers; gates per task `pnpm turbo run build lint typecheck test`.
- Branch: `feat/push-notifications`.

---

## File Structure

- `packages/contracts/src/car.ts`, `push.ts` (new), `index.ts` — field + subscription schema.
- `packages/domain/src/car.ts` (bumpCarMileage sets the field), `notify.ts` (new, pure decision logic) + tests.
- `apps/api/src/push-subscription-repository.ts` (new: port + Dynamo + in-memory), `push-routes.ts` (new), `push-sender.ts` (new: port + web-push impl + fake), `notify-worker.ts` (new), `notify-copy.ts` (new); `dynamo-car-repository.ts`, `router.ts`, `handler.ts`, `event-routes.ts`, `reminder-routes.ts`, `chat-tool-executor.ts`, `import-car-route.ts` (modify).
- `infrastructure/cdk/bin/carlog.ts`, `lib/carlog-stack.ts` — VAPID params, cron, routes, bundling.
- `apps/web/src/sw.ts` (new), `vite.config.ts` (injectManifest), `lib/push.ts` (new), `components/EnableNotificationsCard.tsx` (new), `components/QuickOdometerSheet.tsx` (new), `routes/Profile.tsx`, `routes/Vehicle.tsx`, `components/CompleteReminderDialog.tsx` or its caller, `api-client.ts`, `queries.ts`, i18n.
- `scripts/deploy-web.sh` — `VITE_VAPID_PUBLIC_KEY`.

---

### Task 1: `mileageUpdatedAt` everywhere mileage changes

**Files:**
- Modify: `packages/contracts/src/car.ts` + test
- Modify: `packages/domain/src/car.ts` + test
- Modify: `apps/api/src/dynamo-car-repository.ts` + test, `event-routes.ts`, `reminder-routes.ts`, `chat-tool-executor.ts` + test, `import-car-route.ts` + test, `in-memory-car-repository.ts`
- Test files as adjacent.

**Interfaces:**
- Produces: `CarSchema.mileageUpdatedAt: z.string().datetime()` (required on `Car`; NOT on `CreateCarSchema` — server-owned). `createCar` sets it = createdAt. `bumpCarMileage` return type becomes `{ input: CreateCarInput; mileageUpdatedAt: string } | null`? — NO: keep it simple. New domain helper signature:
  `bumpCarMileage(car: Car, mileage: number, now?: () => string): (CreateCarInput & { mileageUpdatedAt: string }) | null` — callers pass the result to `cars.update` which now accepts the optional `mileageUpdatedAt` passthrough. `CarRepository.update(ownerId, id, input, mileageUpdatedAt?)`.

- [ ] **Step 1: Contract test + field**

Add to `packages/contracts/src/car.test.ts` (create if absent — check first):

```ts
describe('CarSchema mileageUpdatedAt', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111', ownerId: 'o', make: 'VW', model: 'Golf',
    year: 2018, mileage: 1000, fuelType: 'diesel',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  it('is required on Car', () => {
    expect(() => CarSchema.parse(base)).toThrow();
    expect(CarSchema.parse({ ...base, mileageUpdatedAt: '2026-01-01T00:00:00.000Z' }).mileageUpdatedAt)
      .toBe('2026-01-01T00:00:00.000Z');
  });
  it('is NOT accepted on CreateCarSchema (server-owned)', () => {
    const parsed = CreateCarSchema.parse({ make: 'VW', model: 'Golf', year: 2018, mileage: 1, fuelType: 'diesel', mileageUpdatedAt: 'x' });
    expect('mileageUpdatedAt' in parsed).toBe(false); // stripped
  });
});
```

Implement: in `CarSchema` extend block add `mileageUpdatedAt: z.string().datetime(),` (next to `updatedAt`). Run red → green.

- [ ] **Step 2: Domain — createCar + bumpCarMileage**

Tests in `packages/domain/src/car.test.ts`:

```ts
it('createCar stamps mileageUpdatedAt = createdAt', () => {
  const car = createCar('o', { make: 'VW', model: 'Golf', year: 2018, mileage: 1, fuelType: 'diesel' }, { now: () => '2026-08-07T00:00:00.000Z' });
  expect(car.mileageUpdatedAt).toBe('2026-08-07T00:00:00.000Z');
});
it('bumpCarMileage carries a fresh mileageUpdatedAt when bumping', () => {
  const car = { ...fixtureCar, mileage: 100, mileageUpdatedAt: '2026-01-01T00:00:00.000Z' };
  const bumped = bumpCarMileage(car, 200, () => '2026-08-07T00:00:00.000Z');
  expect(bumped?.mileageUpdatedAt).toBe('2026-08-07T00:00:00.000Z');
  expect(bumpCarMileage(car, 50, () => 'x')).toBeNull(); // not newer → no bump
});
```

Implement (`packages/domain/src/car.ts`): `createCar` adds `mileageUpdatedAt: timestamp`; `bumpCarMileage(car, mileage, now = nowIso)` returns `{ ...existing CreateCarInput fields, mileageUpdatedAt: now() }` typed as `CreateCarInput & { mileageUpdatedAt: string }`, null as before. Fix the fixture in existing tests (add the field).

- [ ] **Step 3: Repository signature + read-boundary backfill**

`CarRepository.update(ownerId, id, input: CreateCarInput, mileageUpdatedAt?: string)` — when provided, persist it; also persist when `input.mileage !== existing.mileage` even if the arg is absent (the plain car-edit form path) — compute `nowIso()` inside the repo? NO — repos stay dumb. Instead: **route-level decision.** The car PUT route (`router.ts` `/cars/{id}` PUT) loads the existing car, compares mileage, and passes `nowIso()` when it changed. Repos just persist what they're given (absent → keep stored value).

Dynamo + in-memory `toCar`/update accordingly; read boundary backfills:

```ts
// Rows written before mileageUpdatedAt existed backfill from updatedAt — any edit
// bumped updatedAt, so it is the closest honest signal we have for legacy cars.
car.mileageUpdatedAt = car.mileageUpdatedAt ?? car.updatedAt;
```

Dynamo repo test (like the chat legacy-row test): a stored row WITHOUT the field reads back with `mileageUpdatedAt === updatedAt`.

- [ ] **Step 4: All bump call sites**

Update every `bumpCarMileage` consumer to pass the result through:
`event-routes.ts` (2 sites), `reminder-routes.ts` (1), `chat-tool-executor.ts` (2 — inside `loadCurrentCar` flows). Pattern:

```ts
const bumped = bumpCarMileage(car, ev.mileage);
if (bumped) {
  const { mileageUpdatedAt, ...input } = bumped;
  await deps.cars.update(ownerId, carId, input, mileageUpdatedAt);
}
```

`import-car-route.ts`: `createCar` already stamps it (= import time — correct: the odometer value is as-fresh-as-the-import). Executor tests: extend the odometer-bump test to assert `mileageUpdatedAt` moved; add a nickname-only `update_car` test asserting it did NOT move.

- [ ] **Step 5: Gates + commit** — `feat: track when a car's odometer was last updated`

---

### Task 2: Push subscription contract, repo, routes

**Files:**
- Create: `packages/contracts/src/push.ts` + test; modify `index.ts`
- Create: `apps/api/src/push-subscription-repository.ts`, `in-memory-push-subscription-repository.ts`, `push-routes.ts` + test
- Modify: `apps/api/src/router.ts`, `handler.ts`

**Interfaces:**
- Produces (contracts): `PushSubscriptionSchema = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(100) }), lang: z.enum(['uk','en']).default('en') })`; `PushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(1000) })`.
- Produces (api): `type PushSubscriptionRecord = { ownerId: string; endpointHash: string; subscription: PushSubscription; lang: 'uk'|'en'; lastNotified: Record<string, string>; updatedAt: string }`; `interface PushSubscriptionRepository { upsert(rec): Promise<void>; listAll(): Promise<PushSubscriptionRecord[]>; delete(ownerId, endpointHash): Promise<void>; saveLastNotified(ownerId, endpointHash, map): Promise<void> }`; routes `POST/DELETE /push/subscription`; `RouteDeps.pushSubs`.

Row: `PK=USER#<owner>`, `SK=PUSH#<sha256(endpoint) hex 32>`, TTL 180d refreshed on upsert (table TTL attr exists). `listAll` = bounded Scan filtered on `begins_with(SK,'PUSH#')` (same bounded pattern as `recentAcrossOwners`).

Route behavior: POST parses `PushSubscriptionSchema`, hashes endpoint (`node:crypto` sha256 hex slice 32 — API layer, not domain), upserts with empty `lastNotified` preserved on refresh (read-modify-write: keep existing map when re-subscribing same endpoint). DELETE parses `PushUnsubscribeSchema`, deletes. Both 204. Tests: upsert + refresh preserves lastNotified; delete; hash stability; ownership (rows keyed by JWT owner only).

Commit: `feat(api): push subscription storage and routes`

---

### Task 3: Notify decision logic (pure) + worker + copy

**Files:**
- Create: `packages/domain/src/notify.ts` + test (PURE — no I/O)
- Create: `apps/api/src/notify-copy.ts`, `notify-worker.ts` + test
- Modify: `apps/api/src/handler.ts` (payload branch), `packages/domain/src/index.ts`

**Interfaces:**
- Produces (domain): `NOTIFY_STALE_DAYS = 7`, `NOTIFY_RENOTIFY_DAYS = 7`;
  `type NotifyCondition = { carId: string; type: 'mileage'|'reminders'; daysStale?: number; nearest?: { title: string; dueDate?: string; dueMileage?: number } }`;
  `evaluateCarConditions(car: Car, reminders: Reminder[], today: string): NotifyCondition[]` (uses `reminderStatus`);
  `decideNotifications(conditions: NotifyCondition[], lastNotified: Record<string,string>, today: string): { send: NotifyCondition[]; nextLastNotified: Record<string,string> }` — implements per-day dedupe, 7-day re-notify, prune-cleared.
- Produces (api): `notifyCopy(cond: NotifyCondition, car: Car, lang: 'uk'|'en'): { title: string; body: string; url: string }`; `runNotifyJob(deps, payload)` with `deps = { subs, cars, reminders, sender, remainingMs }`; `NotifyWorkPayload = { jobType: 'notify' }`; `interface PushSender { send(subscription: PushSubscription, payload: string): Promise<'ok'|'gone'> }`.

Domain tests (the heart — be exhaustive): boundary day 7 vs 8 for staleness; a reminder overdue → condition; per-day dedupe (same-day second run sends nothing); 7-day re-notify boundary; condition cleared → key pruned from nextLastNotified; both types on one car → two conditions.

Worker: for each subscription row → load owner's cars (+ reminders per car) → evaluate → decide → send via `PushSender` (JSON payload `{title, body, url}` from `notifyCopy`) → `'gone'` → delete row; else `saveLastNotified`. `remainingMs()` guard per subscription (bail like import worker). Worker tests with in-memory fakes: sends, dedupes across two same-day runs, deletes gone subs, respects budget.

Copy (two-language constant map in `notify-copy.ts`):
- mileage: uk title `🚗 <name>`, body `Пробіг не оновлювався ${d} дн.` / en `Odometer not updated in ${d} days`; url `/cars/<id>?odometer=1`.
- reminders: title `🔧 <nearest.title>`, body from due target (`за N км` / `in N km`, date variant likewise — small helpers, tested); url `/cars/<id>?tab=reminders`.

`handler.ts`: add `isNotifyPayload` branch (like `isImportPayload`) constructing deps with the real `WebPushSender` (Task 4).

Commit: `feat: notification decision logic and notify worker`

---

### Task 4: web-push sender + CDK (cron, VAPID, routes, bundling)

**Files:**
- Create: `apps/api/src/push-sender.ts`, `in-memory-push-sender.ts`
- Modify: `apps/api/package.json` (+`web-push`, `@types/web-push` dev), `handler.ts`
- Modify: `infrastructure/cdk/bin/carlog.ts`, `lib/carlog-stack.ts`, `scripts/deploy-web.sh`

`push-sender.ts`:

```ts
import webpush from 'web-push';
import type { PushSubscription } from '@carlog/contracts';

export interface PushSender { send(sub: PushSubscription, payload: string): Promise<'ok' | 'gone'> }

// VAPID from env (SSM-resolved at synth, same mechanism as the Bedrock token).
export class WebPushSender implements PushSender {
  constructor() {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:admin@carlog.app',
      process.env.VAPID_PUBLIC_KEY ?? '',
      process.env.VAPID_PRIVATE_KEY ?? '',
    );
  }
  async send(sub: PushSubscription, payload: string): Promise<'ok' | 'gone'> {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      console.error('push send failed', status);
      throw err; // worker catches per-subscription
    }
  }
}
```

CDK:
- `bin/carlog.ts`: `vapidPublicKey: readSecureParam('/carlog/vapid-public-key')`, `vapidPrivateKey: readSecureParam('/carlog/vapid-private-key')` (props like the bearer token). Task 6 creates the parameters BEFORE the first synth.
- Stack: env vars `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT`; `new CfnOutput(this, 'VapidPublicKey', { value: props.vapidPublicKey })`; routes `POST`+`DELETE /push/subscription` (JWT); EventBridge:

```ts
    new Rule(this, 'DailyNotify', {
      schedule: Schedule.cron({ minute: '0', hour: '7' }),
      targets: [new LambdaFunction(fn, { event: RuleTargetInput.fromObject({ jobType: 'notify' }) })],
    });
```

(imports from `aws-cdk-lib/aws-events` + `aws-events-targets`); **bundling: `nodeModules: ['@aws-sdk/client-transcribe-streaming', 'web-push']`**.
- `deploy-web.sh`: read `VapidPublicKey` output like the others, append `VITE_VAPID_PUBLIC_KEY=$VAPID_PUB` to `.env.production`.

Verification: gates; synth; **extract the CarsFn asset and confirm `node_modules/web-push` exists** (paste evidence). Commit: `feat: web-push sender, daily cron, VAPID wiring`

---

### Task 5: Web — injectManifest SW, push lib, permission UX, quick odometer sheet

**Files:**
- Create: `apps/web/src/sw.ts`, `lib/push.ts`, `components/EnableNotificationsCard.tsx`, `components/QuickOdometerSheet.tsx`
- Modify: `vite.config.ts`, `api-client.ts`, `queries.ts`, `routes/Profile.tsx`, `routes/Vehicle.tsx`, `components/RemindersSection.tsx` (post-complete prompt), i18n `{en,uk}` (`common` or new `push` namespace + registration)

`vite.config.ts`: `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`, keep manifest/includeAssets; move workbox options into `injectManifest: { globPatterns }` + replicate behavior in sw.ts.

`sw.ts` (complete):

```ts
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
```

Add `workbox-precaching`, `workbox-routing`, `workbox-core` as devDependencies IF not already transitive-resolvable (check `pnpm why workbox-precaching`; vite-plugin-pwa usually brings `workbox-*` — verify importability, add explicitly if not).

`lib/push.ts`: `pushSupported()` (`'serviceWorker' in navigator && 'PushManager' in window && Notification`), `isStandalone()`, `subscribeToPush(token, lang)` (requestPermission → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY) })` → POST), `refreshPushSubscription(token, lang)` (permission already granted → getSubscription → re-POST; called once from the app shell on auth), `unsubscribeFromPush(token)`. Include the standard `urlBase64ToUint8Array` helper.

`api-client.ts`: `savePushSubscription(token, sub, lang)`, `deletePushSubscription(token, endpoint)` (204 paths).

`EnableNotificationsCard` (Profile): hidden when unsupported-and-not-iOS-browser, subscribed, or dismissed-denied; iOS-browser-tab state shows Add-to-Home-Screen guidance; Enable button → `subscribeToPush`; success snackbar. i18n keys (en/uk): `pushTitle`, `pushBody`, `pushEnable`, `pushEnabled`, `pushDenied`, `pushIosInstall`.

Post-completion prompt (`RemindersSection` or `CompleteReminderDialog` success path): once-ever (localStorage `carlog.pushPromptShown`), only when supported && permission `default` && standalone — snackbar with Enable action.

`QuickOdometerSheet`: Modal bottom sheet; big numeric TextField prefilled with `car.mileage`; chips `+50 +100 +500` increment; inline warning (not blocking) when value < current; Save → existing update-car mutation with full CreateCarInput (loaded car + new mileage); success closes + snackbar. Opens from: Vehicle page `?odometer=1` search param (clear the param after opening — `setSearchParams` replace) and tapping the hero's odometer stat tile (add onClick + cursor). i18n: `odometerTitle`, `odometerSave`, `odometerLower`, `odometerUpdated`.

Commit: `feat(web): push subscription flow, custom SW, quick odometer sheet`

---

### Task 6: VAPID provisioning, merge, deploy, verify

- [ ] **Step 1: Generate + store VAPID keys** (idempotent — skip if params exist):

```bash
aws ssm get-parameter --name /carlog/vapid-public-key --profile yevhenii >/dev/null 2>&1 || {
  KEYS=$(cd apps/api && npx web-push generate-vapid-keys --json)
  aws ssm put-parameter --name /carlog/vapid-public-key --type SecureString --value "$(echo $KEYS | python3 -c 'import json,sys; print(json.load(sys.stdin)["publicKey"])')" --profile yevhenii
  aws ssm put-parameter --name /carlog/vapid-private-key --type SecureString --value "$(echo $KEYS | python3 -c 'import json,sys; print(json.load(sys.stdin)["privateKey"])')" --profile yevhenii
}
```

- [ ] **Step 2:** Gates 18/18; `carlog-docs/API.md` push routes; commit docs.
- [ ] **Step 3:** Merge `--no-ff`; synth; **verify asset contains `web-push`**; `cdk diff` (expect: rule, 2 routes, permission, env vars, bundle); deploy backend; deploy web (verify `.env.production` gained the VAPID key and built `sw.js` still has 0 `execute-api` refs and DOES contain `notificationclick`).
- [ ] **Step 4:** Live: unauth POST /push/subscription → 401; manually invoke the notify Lambda once (`aws lambda invoke --payload '{"jobType":"notify"}'`) → logs clean (no subscriptions yet → no-op).
- [ ] **Step 5 (user):** on iPhone PWA: Profile → Enable notifications → grant; make Галя's mileage stale-eligible (it likely already is) → manually invoke the notify Lambda again → push arrives → tap → odometer sheet opens → +500 → Save. Then the cron takes over daily.

---

## Notes for the implementer

- `mileageUpdatedAt` is server-owned: never accepted from clients (CreateCarSchema strips it), always stamped server-side.
- The notify worker must never throw past a single subscription — per-subscription try/catch, continue.
- SW change is the riskiest part: after Task 5, run `pnpm --filter @carlog/web build` and manually inspect `dist/sw.js` — precache manifest present, nav fallback present, 0 execute-api, push handlers present. A broken SW bricks the installed PWA.
- The permission prompt is user-gesture-gated on iOS: `subscribeToPush` must be called directly from the button's click handler, not a `useEffect`.
