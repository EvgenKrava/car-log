# Public Shared Vehicle History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Owner-toggleable, read-only PUBLIC page of a car's full service history at `/s/<carId>`, served by an unauthenticated API, with a per-car `shared` flag (default false).

**Architecture:** Public identifier = the car's UUID. A `SHARE#<carId>` index item (written only while shared) resolves `carId → ownerId` for the anonymous `GET /public/cars/{carId}` route (authorizer disabled, dispatched before the router's 401 guard). Response is a sanitized `PublicCar` DTO (no owner fields), with proof images as short-lived S3 signed URLs.

**Tech:** AWS Lambda + DynamoDB + S3 presign; React + MUI + TanStack Query + Zod; CDK; i18n.

## Global Constraints
- Strict TS, never `any`; `type` aliases; `interface` only for ports. Domain no AWS SDK.
- Zod in `packages/contracts` is source of truth. Extensionless imports. No TODO/stub. No co-authorship trailer. Trailing newline.
- Public route MUST be unauthenticated AND must never expose `ownerId`/email or any other user's data.
- AWS profile `yevhenii`, us-east-1. Commit per task; push to `main`.

## File structure
- `packages/contracts/src/car.ts` (+`shared`), `src/share.ts` (new: SetSharing, PublicCar), `src/index.ts`.
- `packages/domain/src/car-repository.ts` (+2 methods), `src/car.ts` (createCar sets shared:false).
- `apps/api/src/dynamo-car-repository.ts`, `in-memory-car-repository.ts` (impl), `to-public-car.ts` (new mapper), `public-routes.ts` (new), `router.ts`/`handler.ts` (wire), `car-routes`? sharing route goes in `router.ts` cars block.
- `infrastructure/cdk/lib/carlog-stack.ts` (routes).
- `apps/web/src/api-client.ts`, `queries.ts`, `components/ShareCarDialog.tsx` (new), `routes/Vehicle.tsx` (menu item), `routes/PublicVehicle.tsx` (new), `main.tsx` (public route), `i18n/locales/{en,uk}/share.json` (new) + `i18n/index.ts`.

---

## Task 1: Contracts

**Files:** modify `packages/contracts/src/car.ts`, create `packages/contracts/src/share.ts`, modify `index.ts`, test `packages/contracts/src/share.test.ts`.

- [ ] **Step 1: add `shared` to CarSchema** — in `car.ts`, add to `CarSchema` (the stored car, NOT `CreateCarSchema`): `shared: z.boolean().default(false),`. Run `pnpm --filter @carlog/contracts test` to confirm existing car tests still pass (the default keeps old data valid).

- [ ] **Step 2: failing test** `share.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SetSharingSchema, PublicCarSchema } from './share';

describe('share contracts', () => {
  it('validates SetSharing', () => {
    expect(SetSharingSchema.parse({ shared: true })).toEqual({ shared: true });
    expect(() => SetSharingSchema.parse({})).toThrow();
  });
  it('parses a public car (no owner fields)', () => {
    const pc = {
      id: '11111111-1111-1111-1111-111111111111', make: 'Mitsubishi', model: 'Galant',
      year: 2008, fuelType: 'petrol', mileage: 250000, vin: 'X', licensePlate: 'AX',
      events: [{ id: '22222222-2222-2222-2222-222222222222', date: '2026-01-01', category: 'oil_change', mileage: 250000, cost: 100, currency: 'UAH', works: [], proofs: [] }],
    };
    expect(PublicCarSchema.parse(pc)).toMatchObject({ make: 'Mitsubishi' });
    expect('ownerId' in PublicCarSchema.parse(pc)).toBe(false);
  });
});
```

- [ ] **Step 3: implement** `share.ts`:

```ts
import { z } from 'zod';
import { WorkSchema, EventCategorySchema } from './event';
import { FuelTypeSchema } from './car';

export const SetSharingSchema = z.object({ shared: z.boolean() });

export const PublicProofSchema = z.object({
  url: z.string(), contentType: z.string(), filename: z.string().optional(),
});
export const PublicEventSchema = z.object({
  id: z.string(), date: z.string(), category: EventCategorySchema,
  mileage: z.number(), cost: z.number(), currency: z.string(),
  title: z.string().optional(), notes: z.string().optional(),
  works: z.array(WorkSchema), proofs: z.array(PublicProofSchema),
});
export const PublicCarSchema = z.object({
  id: z.string(), make: z.string(), model: z.string(), year: z.number(),
  nickname: z.string().optional(), fuelType: FuelTypeSchema, engineVolume: z.number().optional(),
  mileage: z.number(), vin: z.string().optional(), licensePlate: z.string().optional(),
  events: z.array(PublicEventSchema),
});

export type SetSharingInput = z.infer<typeof SetSharingSchema>;
export type PublicEvent = z.infer<typeof PublicEventSchema>;
export type PublicCar = z.infer<typeof PublicCarSchema>;
```

(Confirm `WorkSchema`/`EventCategorySchema` are exported from `./event` and `FuelTypeSchema` from `./car`; adjust import if names differ.)

- [ ] **Step 4:** add `export * from './share';` to `index.ts`. Run `pnpm --filter @carlog/contracts test` → PASS. Commit `feat(contracts): sharing + public car schemas`.

---

## Task 2: CarRepository sharing (port + impls)

**Files:** `packages/domain/src/car-repository.ts`, `packages/domain/src/car.ts` (createCar), `apps/api/src/dynamo-car-repository.ts`, `apps/api/src/in-memory-car-repository.ts`, test `apps/api/src/in-memory-car-repository.test.ts`.

**Interfaces (added to `CarRepository`):**
- `setShared(ownerId: string, id: string, shared: boolean): Promise<Car>`
- `findSharedOwnerId(carId: string): Promise<string | null>`

- [ ] **Step 1: createCar defaults shared** — in `packages/domain/src/car.ts`, where the `Car` object is built, add `shared: false,`.

- [ ] **Step 2: port** — add the two method signatures to the `CarRepository` interface.

- [ ] **Step 3: in-memory impl + test (TDD).** In `in-memory-car-repository.ts` add a `shared = new Map<string, string>()` (carId→ownerId) and:

```ts
async setShared(ownerId: string, id: string, shared: boolean): Promise<Car> {
  const car = await this.getById(ownerId, id);
  if (!car) throw new Error('car not found');
  const updated = { ...car, shared };
  this.rows.set(this.key(ownerId, id), updated);   // adapt to the store's key/field
  if (shared) this.sharedIndex.set(id, ownerId); else this.sharedIndex.delete(id);
  return updated;
}
async findSharedOwnerId(carId: string): Promise<string | null> {
  return this.sharedIndex.get(carId) ?? null;
}
```
Test:
```ts
it('setShared writes/removes the share index', async () => {
  const repo = new InMemoryCarRepository();
  const car = await repo.create(mkCar('u1', 'c1'));
  expect(await repo.findSharedOwnerId('c1')).toBeNull();
  await repo.setShared('u1', 'c1', true);
  expect(await repo.findSharedOwnerId('c1')).toBe('u1');
  expect((await repo.getById('u1','c1'))!.shared).toBe(true);
  await repo.setShared('u1', 'c1', false);
  expect(await repo.findSharedOwnerId('c1')).toBeNull();
});
```
(write `mkCar` per the Car shape; `shared` defaults false via createCar/schema). Run test → PASS.

- [ ] **Step 4: dynamo impl.** In `dynamo-car-repository.ts`, add helpers `sharePk = (carId) => \`SHARE#${carId}\`` and `SHARE_SK = 'SHARE'`, then:

```ts
async setShared(ownerId: string, id: string, shared: boolean): Promise<Car> {
  const car = await this.getById(ownerId, id);
  if (!car) throw new CarNotFoundError(id);
  const updated: Car = { ...car, shared };
  await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(updated) }));
  if (shared) {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: { PK: sharePk(id), SK: SHARE_SK, ownerId, carId: id } }));
  } else {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: sharePk(id), SK: SHARE_SK } }));
  }
  return updated;
}
async findSharedOwnerId(carId: string): Promise<string | null> {
  const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: sharePk(carId), SK: SHARE_SK } }));
  return (res.Item?.ownerId as string | undefined) ?? null;
}
```
(`CarNotFoundError` is already imported/used in this file or in domain — import if needed; `GetCommand`/`PutCommand`/`DeleteCommand` already imported.)

- [ ] **Step 5:** `pnpm --filter @carlog/api test && pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/domain typecheck` → PASS. **Fix every other `CarRepository` fake** in api tests (router.test etc.) by adding `setShared: async () => ({} as never)` / `findSharedOwnerId: async () => null` stubs (or realistic). Commit `feat(api): CarRepository sharing (SHARE index item)`.

---

## Task 3: toPublicCar sanitizer

**Files:** create `apps/api/src/to-public-car.ts`, test `apps/api/src/to-public-car.test.ts`.

**Interface:** `toPublicCar(car: Car, events: Array<Event & { proofs: { url: string; contentType: string; filename?: string }[] }>): PublicCar` — maps allowed fields only; NO ownerId/email/createdAt.

- [ ] **Step 1: failing test** asserting mapping + that `ownerId` is absent from the output and from each event.

```ts
import { describe, it, expect } from 'vitest';
import { toPublicCar } from './to-public-car';

it('maps allowed fields and drops owner data', () => {
  const car = { id: 'c1', ownerId: 'secret', make: 'M', model: 'G', year: 2008, fuelType: 'petrol', mileage: 100, vin: 'V', licensePlate: 'P', shared: true, createdAt: 'x', updatedAt: 'y' } as never;
  const events = [{ id: 'e1', ownerId: 'secret', carId: 'c1', date: '2026-01-01', category: 'oil_change', mileage: 100, cost: 50, currency: 'UAH', works: [], createdAt: 'x', updatedAt: 'y', proofs: [{ url: 'https://s/1', contentType: 'image/jpeg' }] }] as never;
  const pc = toPublicCar(car, events);
  expect(JSON.stringify(pc)).not.toContain('secret');
  expect(pc).toMatchObject({ make: 'M', vin: 'V', events: [{ id: 'e1', cost: 50, proofs: [{ url: 'https://s/1' }] }] });
});
```

- [ ] **Step 2: implement** — explicit field-by-field mapping (never spread the record, so owner fields can't leak):

```ts
import type { Car, Event, PublicCar } from '@carlog/contracts';

type WithProofs = Event & { proofs: { url: string; contentType: string; filename?: string }[] };

export function toPublicCar(car: Car, events: WithProofs[]): PublicCar {
  return {
    id: car.id, make: car.make, model: car.model, year: car.year,
    nickname: car.nickname, fuelType: car.fuelType, engineVolume: car.engineVolume,
    mileage: car.mileage, vin: car.vin, licensePlate: car.licensePlate,
    events: events.map((e) => ({
      id: e.id, date: e.date, category: e.category, mileage: e.mileage,
      cost: e.cost, currency: e.currency, title: e.title, notes: e.notes,
      works: e.works,
      proofs: e.proofs.map((p) => ({ url: p.url, contentType: p.contentType, filename: p.filename })),
    })),
  };
}
```

- [ ] **Step 3:** test → PASS. Commit `feat(api): toPublicCar sanitizer`.

---

## Task 4: public route + sharing route + wiring

**Files:** create `apps/api/src/public-routes.ts`; modify `router.ts`, `handler.ts`; test `apps/api/src/public-routes.test.ts` (+ add sharing-route test to router.test).

- [ ] **Step 1: public-routes.ts** — dependencies it needs: `cars`, `events`, `proofs`, `storage` (all in RouteDeps). Reuse the proof-signing pattern from `event-routes.ts` (`storage.presignGet(proofKey(ownerId, carId, eventId, p.id))`).

```ts
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';
import type { CarRepository } from '@carlog/domain';
import type { EventRepository, ProofRepository, PhotoStorage } from '@carlog/domain';
import { proofKey } from './event-key';
import { toPublicCar } from './to-public-car';

type PublicDeps = { cars: CarRepository; events: EventRepository; proofs: ProofRepository; storage: PhotoStorage };

export async function handlePublicRoute(deps: PublicDeps, event: ApiEvent): Promise<ApiResult | undefined> {
  const { method, path, pathParams } = event;
  if (!path.startsWith('/public/cars/')) return undefined;
  const carId = pathParams.carId;
  if (method !== 'GET' || !carId) return ok(404, { error: 'Not found' });

  const ownerId = await deps.cars.findSharedOwnerId(carId);
  if (!ownerId) return ok(404, { error: 'Not found' });
  const car = await deps.cars.getById(ownerId, carId);
  if (!car || !car.shared) return ok(404, { error: 'Not found' });

  const events = await deps.events.listByCar(ownerId, carId);
  const withProofs = await Promise.all(events.map(async (e) => {
    const proofs = await deps.proofs.listByEvent(ownerId, carId, e.id);
    const signed = await Promise.all(proofs.map(async (p) => ({
      url: await deps.storage.presignGet(proofKey(ownerId, carId, e.id, p.id)),
      contentType: p.contentType, filename: p.filename,
    })));
    return { ...e, proofs: signed };
  }));
  return ok(200, toPublicCar(car, withProofs));
}
```
(Confirm `PhotoStorage` and `proofKey`/`Proof.filename`/`Proof.contentType` names; adjust to match. `PhotoStorage` type is exported from `@carlog/domain`.)

- [ ] **Step 2: router wiring.** In `router.ts` `route()`, **before** the `if (!ownerId) return ok(401, ...)` line, add:
```ts
if (path.startsWith('/public/')) {
  const result = await handlePublicRoute({ cars: deps.cars, events: deps.events, proofs: deps.proofs, storage: deps.storage }, event);
  if (result) return result;
}
```
Also add `carId` handling: `event.pathParameters` for route `/public/cars/{carId}` yields `{ carId }` — `ApiEvent.pathParams` already carries all path params, so `pathParams.carId` works. Add the **sharing route** in the authed cars block:
```ts
if (id && path === `/cars/${id}/sharing` && method === 'PUT') {
  const { shared } = SetSharingSchema.parse(body);
  return ok(200, await deps.cars.setShared(ownerId, id, shared));
}
```
Import `SetSharingSchema` from `@carlog/contracts` and `handlePublicRoute`.

- [ ] **Step 3: handler.ts** — no new deps (cars/events/proofs/storage already in `deps`). Nothing to construct. (Confirm `deps` already includes `proofs` and `storage` — it does, used by event routes.)

- [ ] **Step 4: tests** — `public-routes.test.ts`: with fake repos, (a) unknown/not-shared car → 404; (b) shared car → 200 with sanitized DTO incl. signed proof urls (fake `storage.presignGet` returns a stub). Add to `router.test.ts`: `PUT /cars/{id}/sharing` → 200 and calls `setShared`. Verify public path is reached without a token (the fake event has `ownerId: null, groups: []`, path `/public/cars/c1`) and does NOT 401.

- [ ] **Step 5:** `pnpm --filter @carlog/api test && typecheck && lint` → PASS. Commit `feat(api): public shared-car route + sharing toggle`.

---

## Task 5: CDK routes

**Files:** `infrastructure/cdk/lib/carlog-stack.ts`.

- [ ] **Step 1:** add (near the other `httpApi.addRoutes`):
```ts
httpApi.addRoutes({ path: '/cars/{id}/sharing', methods: [HttpMethod.PUT], integration, authorizer });
httpApi.addRoutes({ path: '/public/cars/{carId}', methods: [HttpMethod.GET], integration }); // NO authorizer — public
```
- [ ] **Step 2:** `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth` succeeds; confirm the `/public/cars/{carId}` route has NO authorizer and `/cars/{id}/sharing` has one (grep the template: the public route's `AuthorizationType` should be `NONE`). Commit `feat(cdk): public shared-car + sharing routes`.

---

## Task 6: Frontend api-client + hooks

**Files:** `apps/web/src/api-client.ts`, `queries.ts`.

- [ ] **Step 1: api-client** — `setCarSharing(token, carId, shared)` mirrors `updateCar` (`request(token, \`/cars/${carId}/sharing\`, CarSchema, { method: 'PUT', body: JSON.stringify({ shared }) })`). `getPublicCar(carId): Promise<PublicCar>` — a PLAIN fetch (no Authorization header), validated with `PublicCarSchema`:
```ts
export async function getPublicCar(carId: string): Promise<PublicCar> {
  const res = await fetch(`${API_URL}/public/cars/${encodeURIComponent(carId)}`);
  if (res.status === 404) throw new Error('NOT_SHARED');
  if (!res.ok) throw new Error(`API ${res.status}`);
  return PublicCarSchema.parse(await res.json());
}
```
- [ ] **Step 2: queries** — `useSetCarSharing()` (mutation; invalidates `['cars', carId]` and `['cars']`); `usePublicCar(carId)` (`queryKey: ['public', carId]`, `queryFn: () => getPublicCar(carId)`, `enabled: Boolean(carId)`, `retry: false`). Typecheck + lint. Commit `feat(web): public car + sharing client/hooks`.

---

## Task 7: Owner share dialog + menu entry

**Files:** create `apps/web/src/components/ShareCarDialog.tsx`; modify `apps/web/src/routes/Vehicle.tsx`.

- [ ] **Step 1: ShareCarDialog** — uses the universal `Modal`. Props `{ open, onClose, car }`. A `Switch` bound to `car.shared` calling `useSetCarSharing().mutate({ carId, shared })`. When `car.shared`, show the read-only public link `${window.location.origin}/s/${car.id}` in a `TextField` + a Copy button (`navigator.clipboard.writeText`) and a Share button (`navigator.share`, clipboard fallback). Localized via `t('share:...')`.
- [ ] **Step 2: Vehicle** — add a "Public link" `MenuItem` (icon `PublicIcon` or `LinkIcon`) to the car-actions menu that opens `ShareCarDialog`. Keep the existing text-Share action or replace it with this dialog (dialog is richer). Typecheck + build + lint. Commit `feat(web): owner public-link share dialog`.

---

## Task 8: Public page + route

**Files:** create `apps/web/src/routes/PublicVehicle.tsx`; modify `apps/web/src/main.tsx`.

- [ ] **Step 1: PublicVehicle** — `useParams` carId → `usePublicCar(carId)`. States: loading → `StatusView loading`; error/NOT_SHARED → a centered "This history isn't shared" `EmptyState` with a link to the app; success → a read-only hero (title, make/model/year/fuel, mileage, VIN/plate chips — reuse the presentational bits from `Vehicle.tsx` or a simplified inline version) and a read-only timeline: for each event, a card with the category icon (`CATEGORY_META`), date, mileage, cost, works/parts lines, and proof thumbnails (`<img>`/PDF link from `proofs[].url`). NO `AppShell` menu/FAB/bottom-bar, NO edit/delete. A footer: "Shared via CarLog" linking to `/`. Mobile-first.
- [ ] **Step 2: main.tsx** — add `<Route path="/s/:carId" element={<PublicVehicle />} />` **outside** any `RequireAuth` (it's public). Import `PublicVehicle`.
- [ ] **Step 3:** typecheck + build + lint. Commit `feat(web): public read-only vehicle page`.

---

## Task 9: i18n

**Files:** create `apps/web/src/i18n/locales/{en,uk}/share.json`; modify `i18n/index.ts`.

- [ ] **Step 1:** register a `share` namespace (mirror how `admin` is wired — imports + `ns` + `resources` for en/uk). Keys (en / uk): `menu` "Public link"/"Публічне посилання", `title` "Share this car"/"Поділитися авто", `toggle` "Make history public"/"Зробити історію публічною", `hint` "Anyone with the link can view this car's service history."/"Будь-хто з посиланням може переглянути історію обслуговування.", `copy` "Copy"/"Копіювати", `copied` "Copied"/"Скопійовано", `share` "Share"/"Поділитися", `notShared` "This history isn't shared."/"Ця історія не є публічною.", `sharedVia` "Shared via CarLog"/"Опубліковано через CarLog", `readOnly` "Read-only"/"Лише для перегляду".
- [ ] **Step 2:** typecheck + build. Commit `feat(web): en/uk strings for public sharing`.

---

## Task 10: Deploy + verify
- [ ] `pnpm turbo run build lint typecheck test` green.
- [ ] CDK deploy, then `./scripts/deploy-web.sh`.
- [ ] Verify: toggle sharing on for a car → `GET <ApiUrl>/public/cars/<carId>` returns 200 sanitized JSON (no `ownerId`), and `/s/<carId>` renders read-only; toggle off → `GET /public/cars/<carId>` 404 + page shows "not shared"; `GET /cars/<id>` unauth still 401. New web bundle hash live; invalidation completed. (No token minting.)

---

## Self-review
- Coverage: shared flag + DTO → T1; index+repo → T2; sanitizer → T3; routes+guard-order → T4; CDK no-auth route → T5; client/hooks → T6; owner toggle UI → T7; public page → T8; i18n → T9; deploy → T10.
- Security: public route unauthenticated + dispatched before 401; `findSharedOwnerId` gates on the SHARE item; `toPublicCar` maps explicit fields (no owner leak, asserted by test); proofs via short-lived signed URLs; not-shared → 404.
- Types: `PublicCar`/`PublicEvent` consistent T1↔T3↔T6↔T8; `setShared`/`findSharedOwnerId` consistent T2↔T4; `SetSharingSchema` T1↔T4↔T6.