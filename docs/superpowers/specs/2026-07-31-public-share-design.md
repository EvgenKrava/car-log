# Public / Shared Vehicle History — Design

**Date:** 2026-07-31
**Status:** Approved (design greenlit)

## Goal

Let an owner publish a **read-only public page** of a car's full service history via
an unguessable link (great for selling a car / trust signal). Sharing is an on/off
flag per car (default OFF). The public page requires no login.

## Identifier & link model

- The public identifier is the car's own **UUID v4** id (122 bits — unguessable/
  unenumerable, so no separate token is needed). Public URL: `https://<app>/s/<carId>`.
- `shared: boolean` on the car (default `false`). Owner toggles it. When `false`, the
  public page returns 404.
- **Accepted trade-off:** reusing the car id means a *leaked* link can't be rotated
  while keeping sharing on (toggle off→on yields the same URL). Fine for v1.

## Public content (per owner's choice)

Everything: make/model/year/nickname/fuel/engine, **mileage**, **VIN + license plate**,
and the full timeline — events with **works & parts**, **costs**, and **photos/receipts**
(as short-lived signed URLs). **Never** exposed: ownerId, owner email, or any other
user's data. The response is a purpose-built sanitized DTO, not the internal record.

## Backend

### Sharing lookup (avoids a per-request Scan)
Data is partitioned by owner (`PK=USER#<owner>`), so an anonymous `GET .../{carId}`
can't resolve the car without the owner. Maintain a tiny index item written only while
shared: `PK=SHARE#<carId>`, value `{ ownerId, carId }`.
- Enable sharing → set `car.shared=true` **and** put the `SHARE#<carId>` item.
- Disable → set `car.shared=false` **and** delete the item.
Public lookup is one `GetItem` on `SHARE#<carId>` → ownerId (404 if absent).

### Routes
- `PUT /cars/{id}/sharing` (**authed**) — body `{ shared: boolean }`; validates
  ownership (owner from JWT), calls `cars.setShared(ownerId, id, shared)`, returns the
  updated car.
- `GET /public/cars/{carId}` (**no authorizer**; top-level `/public/*` path so it can't
  collide with the fully-authorized `/cars/*` space; **dispatched before** the router's
  `401 if no owner` guard):
  1. `ownerId = await cars.findSharedOwnerId(carId)` (reads the SHARE index) — 404 if null.
  2. `car = await cars.getById(ownerId, carId)`; if missing or `!car.shared` → 404 (defensive).
  3. `events = await events.listByCar(ownerId, carId)`.
  4. For each event, list its proofs and generate short-lived S3 signed URLs (bucket stays
     private) via the existing proof-signing path.
  5. Return the sanitized `PublicCar` DTO (strip ownerId/email).

### Layering
- Domain `CarRepository` gains `setShared(ownerId, carId, shared): Promise<Car>` and
  `findSharedOwnerId(carId): Promise<string | null>`. Dynamo impl maintains the
  `SHARE#<carId>` item + the `shared` flag; in-memory mirrors. Domain stays SDK-free.
- A thin `handlePublicRoute` module builds the DTO (a pure `toPublicCar(car, events, proofsByEvent)`
  mapper — unit-testable, and the guard against leaking owner fields lives here).

### Contracts (Zod)
- Add `shared: z.boolean().default(false)` to `CarSchema` (stored car).
- `SetSharingSchema = { shared: boolean }`.
- `PublicCarSchema`: `{ id, make, model, year, nickname?, fuelType, engineVolume?, mileage,
  vin?, licensePlate?, events: PublicEvent[] }`; `PublicEventSchema`: `{ id, date, category,
  mileage, cost, currency, title?, notes?, works: Work[], proofs: { url, contentType,
  filename? }[] }`. No owner fields.

### CDK
- Register `GET /public/cars/{carId}` with the authorizer **omitted** (public), and
  `PUT /cars/{id}/sharing` with the authorizer. No new IAM (Dynamo + S3 read/sign already granted).

## Frontend

- **api-client:** `getPublicCar(carId): Promise<PublicCar>` — plain fetch to
  `${API_URL}/public/cars/{carId}` with **no** Authorization header. `setCarSharing(token,
  carId, shared): Promise<Car>`.
- **queries:** `usePublicCar(carId)` (no token, `enabled` on carId) and `useSetCarSharing()`
  (invalidates the car).
- **Owner UI (Vehicle):** a **"Public link"** entry in the car-actions menu opens a small
  `Modal`: a toggle (bound to `car.shared` via `useSetCarSharing`), and when on, the
  copyable `https://<app>/s/<carId>` with copy + native-share buttons (wire the existing
  Share action to this link).
- **Public page:** an **unauthenticated** route `/s/:carId` (declared OUTSIDE `RequireAuth`
  in `main.tsx`) → `PublicVehicle`: read-only hero (identity + mileage + VIN/plate) and a
  read-only timeline (events with works/parts/costs and proof thumbnails) — **no** app menu,
  FAB, edit/delete, or bottom bar. A subtle "Shared via CarLog" footer linking to the app.
  Clean loading / 404 ("This history isn't shared") states.
- Full **en/uk** i18n (new `share` namespace).

## Testing

- `toPublicCar` sanitizer: asserts no `ownerId`/email leak; maps works/parts/costs/proofs.
- Share lifecycle: `setShared(true)` writes index + flag; `setShared(false)` deletes index;
  `findSharedOwnerId` returns owner only while shared (in-memory repo test).
- Public route: 404 when not shared / unknown car; 200 sanitized when shared; guard-ordering
  (public path reached without a token, never hits the 401 guard).
- Live: toggle on → `/public/cars/{id}` 200; toggle off → 404; unauth `/cars/{id}` still 401.

## Out of scope (later)

- Rotatable/expiring tokens; per-field public visibility toggles (v1 shows all agreed fields).
- Public page SEO/OG meta, QR code, "report" abuse flow.