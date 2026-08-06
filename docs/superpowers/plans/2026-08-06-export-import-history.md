# Export / Import Car History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export one car's full service book (profile + events + reminders) as a versioned JSON file from the Vehicle page; import such a file from the Garage as a new car, with server-side batch creation and cleanup on failure.

**Architecture:** `CarExportSchema` in contracts is the single source of truth for both directions. Export is pure client-side (`toCarExport` in domain + Blob download). Import is one authed route `POST /import/car` that creates car → events → reminders directly via repositories, deleting everything created so far if any write fails.

**Tech Stack:** Zod contracts, pure domain fn, Lambda route, React + MUI dialog, CDK route.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-06-export-import-history-design.md` is authoritative.
- Format constants: `CAR_EXPORT_FORMAT = 'carlog-car'`, `CAR_EXPORT_VERSION = 1`, `attachments: 'not-included'`.
- Caps come from existing constants: `MAX_JOB_EVENTS` (500) events, `MAX_REMINDERS_PER_CAR` (20) reminders — enforced by the schema.
- Import car mileage = the file's `car.mileage` verbatim; never re-derived from events.
- **A half-imported car must never remain**: failure at any write deletes everything created so far (current-phase items, then events, then the car), then rethrows.
- `packages/domain` stays SDK-free; strict TS, never `any`; explicit field mapping (no spread-and-delete) in `toCarExport`.
- i18n en+uk symmetric. No TODO/stubs. Trailing newline. Conventional commits, NO trailers.
- Gates per task: `pnpm turbo run build lint typecheck test`.
- Branch: `feat/export-import-history`.

---

## File Structure

- `packages/contracts/src/export.ts` (create) + test — `CarExportSchema`, constants.
- `packages/contracts/src/index.ts` (modify) — barrel export.
- `packages/domain/src/car-export.ts` (create) + test — `toCarExport`.
- `packages/domain/src/index.ts` (modify) — barrel export.
- `apps/api/src/import-car-route.ts` (create) + test — the route with cleanup.
- `apps/api/src/router.ts` (modify) — dispatch `/import/car` BEFORE the `/import/` job branch.
- `infrastructure/cdk/lib/carlog-stack.ts` (modify) — one route.
- `apps/web/src/lib/download-json.ts` (create) — Blob download helper.
- `apps/web/src/routes/Vehicle.tsx` (modify) — Export menu item.
- `apps/web/src/components/ImportCarDialog.tsx` (create) — file pick + preview + import.
- `apps/web/src/routes/Garage.tsx` (modify) — Import entry.
- `apps/web/src/api-client.ts`, `apps/web/src/queries.ts` (modify) — `importCar` + hook.
- `apps/web/src/i18n/locales/{en,uk}/vehicle.json`, `{en,uk}/garage.json` (modify) — keys.
- `carlog-docs/API.md` (modify, Task 4) — the new route.

---

### Task 1: Contract + domain export function

**Files:**
- Create: `packages/contracts/src/export.ts`, `packages/contracts/src/export.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/car-export.ts`, `packages/domain/src/car-export.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `CAR_EXPORT_FORMAT`, `CAR_EXPORT_VERSION`, `CarExportSchema`, `type CarExport`;
  `toCarExport(car: Car, events: Event[], reminders: Reminder[], exportedAt: string): CarExport`.

- [ ] **Step 1: Failing contract test**

Create `packages/contracts/src/export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CarExportSchema, CAR_EXPORT_FORMAT, CAR_EXPORT_VERSION } from './export';

const golden = {
  format: 'carlog-car',
  version: 1,
  exportedAt: '2026-08-06T10:00:00.000Z',
  attachments: 'not-included',
  car: { make: 'VW', model: 'Golf', year: 2018, mileage: 92000, fuelType: 'diesel' },
  events: [{
    date: '2024-02-01', mileage: 84000, cost: 3000, currency: 'UAH', category: 'brakes',
    works: [{ description: 'Front pads', parts: [{ name: 'Pads', quantity: 1 }] }],
  }],
  reminders: [{ title: 'Oil', category: 'oil_change', dueMileage: 100000 }],
};

describe('CarExportSchema', () => {
  it('accepts a golden export file', () => {
    const parsed = CarExportSchema.parse(golden);
    expect(parsed.format).toBe(CAR_EXPORT_FORMAT);
    expect(parsed.version).toBe(CAR_EXPORT_VERSION);
    expect(parsed.events[0]!.works[0]!.parts[0]!.name).toBe('Pads');
  });

  it('rejects an unknown version and a wrong format', () => {
    expect(() => CarExportSchema.parse({ ...golden, version: 2 })).toThrow();
    expect(() => CarExportSchema.parse({ ...golden, format: 'carlog-garage' })).toThrow();
  });

  it('strips unknown top-level fields (Zod default) — pinned', () => {
    const parsed = CarExportSchema.parse({ ...golden, hacked: true });
    expect('hacked' in parsed).toBe(false);
  });

  it('rejects over-cap collections', () => {
    const manyReminders = Array.from({ length: 21 }, (_, i) => ({
      title: `r${i}`, category: 'other', dueMileage: 1000 + i,
    }));
    expect(() => CarExportSchema.parse({ ...golden, reminders: manyReminders })).toThrow();
  });
});
```

- [ ] **Step 2: Run to fail**

Run: `pnpm --filter @carlog/contracts test src/export.test.ts`
Expected: FAIL — cannot resolve `./export`.

- [ ] **Step 3: Implement the contract**

Create `packages/contracts/src/export.ts`:

```ts
import { z } from 'zod';
import { CreateCarSchema } from './car';
import { CreateEventSchema } from './event';
import { CreateReminderSchema, MAX_REMINDERS_PER_CAR } from './reminder';
import { MAX_JOB_EVENTS } from './import';

export const CAR_EXPORT_FORMAT = 'carlog-car';
export const CAR_EXPORT_VERSION = 1;

// The portable service book: one car's profile + timeline + reminders, as the CREATE
// shapes — server-owned fields (ids, ownerId, timestamps, shared) are deliberately
// absent; the import re-mints them. `version` is a literal so a future v2 widens it
// to a union and old apps reject newer files instead of mis-reading them.
export const CarExportSchema = z.object({
  format: z.literal(CAR_EXPORT_FORMAT),
  version: z.literal(CAR_EXPORT_VERSION),
  exportedAt: z.string().datetime(),
  // Explicit marker so a future version can carry attachment payloads.
  attachments: z.literal('not-included'),
  car: CreateCarSchema,
  events: z.array(CreateEventSchema).max(MAX_JOB_EVENTS),
  reminders: z.array(CreateReminderSchema).max(MAX_REMINDERS_PER_CAR),
});

export type CarExport = z.infer<typeof CarExportSchema>;
```

Add `export * from './export';` to `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run to pass**

Run: `pnpm --filter @carlog/contracts test src/export.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Failing domain test**

Create `packages/domain/src/car-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Car, Event, Reminder } from '@carlog/contracts';
import { CarExportSchema } from '@carlog/contracts';
import { toCarExport } from './car-export';

const car: Car = {
  id: 'car-1', ownerId: 'owner-secret', make: 'VW', model: 'Golf', year: 2018,
  mileage: 92000, fuelType: 'diesel', engineVolume: 2, nickname: 'Wolfie',
  vin: 'WVWZZZ1KZAW000001', licensePlate: 'AA1234BB',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', shared: true,
};

const events: Event[] = [
  {
    id: 'e-old', carId: 'car-1', ownerId: 'owner-secret', date: '2023-06-01',
    category: 'oil_change', mileage: 70000, cost: 1200, currency: 'UAH',
    title: 'Oil', notes: undefined,
    works: [{ description: 'Oil & filter', parts: [{ name: '5W-30', quantity: 5 }] }],
    createdAt: '2023-06-01T00:00:00.000Z', updatedAt: '2023-06-01T00:00:00.000Z',
  },
  {
    id: 'e-new', carId: 'car-1', ownerId: 'owner-secret', date: '2024-02-01',
    category: 'brakes', mileage: 84000, cost: 3000, currency: 'UAH',
    title: undefined, notes: undefined, works: [],
    createdAt: '2024-02-01T00:00:00.000Z', updatedAt: '2024-02-01T00:00:00.000Z',
  },
];

const reminders: Reminder[] = [{
  id: 'r1', carId: 'car-1', ownerId: 'owner-secret', title: 'Timing belt',
  category: 'repair', dueMileage: 120000, notes: undefined,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
}];

const AT = '2026-08-06T10:00:00.000Z';

describe('toCarExport', () => {
  it('produces a file that parses against the contract (round-trip)', () => {
    const file = toCarExport(car, events, reminders, AT);
    const parsed = CarExportSchema.parse(file);
    expect(parsed.car.make).toBe('VW');
    expect(parsed.car.mileage).toBe(92000);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.reminders[0]!.dueMileage).toBe(120000);
    expect(parsed.exportedAt).toBe(AT);
  });

  it('never leaks server-owned fields — asserted by value', () => {
    const json = JSON.stringify(toCarExport(car, events, reminders, AT));
    expect(json).not.toContain('owner-secret');
    expect(json).not.toContain('car-1');
    expect(json).not.toContain('e-old');
    expect(json).not.toContain('"shared"');
    expect(json).not.toContain('createdAt');
  });

  it('exports events newest-first', () => {
    const file = toCarExport(car, events, reminders, AT);
    expect(file.events.map((e) => e.date)).toEqual(['2024-02-01', '2023-06-01']);
  });

  it('preserves optional fields and defaults', () => {
    const file = toCarExport(car, events, reminders, AT);
    expect(file.car.nickname).toBe('Wolfie');
    expect(file.car.vin).toBe('WVWZZZ1KZAW000001');
    expect(file.events[1]!.works[0]!.parts[0]!.quantity).toBe(5);
  });
});
```

- [ ] **Step 6: Run to fail**

Run: `pnpm --filter @carlog/domain test src/car-export.test.ts`
Expected: FAIL — cannot resolve `./car-export`.

- [ ] **Step 7: Implement**

Create `packages/domain/src/car-export.ts`:

```ts
import type { Car, Event, Reminder, CarExport } from '@carlog/contracts';
import { CAR_EXPORT_FORMAT, CAR_EXPORT_VERSION } from '@carlog/contracts';

// Build the portable export file. Explicit field mapping (never spread-and-delete), the
// same guard style as buildCarChatContext: server-owned identifiers can't leak because
// they are never copied. `exportedAt` is injected — the domain stays clock-free.
export function toCarExport(
  car: Car, events: Event[], reminders: Reminder[], exportedAt: string,
): CarExport {
  return {
    format: CAR_EXPORT_FORMAT,
    version: CAR_EXPORT_VERSION,
    exportedAt,
    attachments: 'not-included',
    car: {
      make: car.make, model: car.model, year: car.year, mileage: car.mileage,
      fuelType: car.fuelType, engineVolume: car.engineVolume,
      nickname: car.nickname, vin: car.vin, licensePlate: car.licensePlate,
    },
    events: [...events]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) // newest first
      .map((e) => ({
        date: e.date, mileage: e.mileage, cost: e.cost, currency: e.currency,
        category: e.category, title: e.title, notes: e.notes,
        works: e.works.map((w) => ({
          description: w.description,
          parts: w.parts.map((p) => ({
            name: p.name, brand: p.brand, partNumber: p.partNumber,
            quantity: p.quantity, notes: p.notes, purchaseLink: p.purchaseLink,
          })),
        })),
      })),
    reminders: reminders.map((r) => ({
      title: r.title, category: r.category, notes: r.notes,
      dueDate: r.dueDate, dueMileage: r.dueMileage,
      repeatMonths: r.repeatMonths, repeatKm: r.repeatKm,
    })),
  };
}
```

Add `export { toCarExport } from './car-export';` to `packages/domain/src/index.ts`.

- [ ] **Step 8: Run to pass, then gates**

Run: `pnpm --filter @carlog/domain test src/car-export.test.ts` → PASS (4 cases).
Run: `pnpm turbo run build lint typecheck test` → green.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/export.ts packages/contracts/src/export.test.ts packages/contracts/src/index.ts packages/domain/src/car-export.ts packages/domain/src/car-export.test.ts packages/domain/src/index.ts
git commit -m "feat(contracts,domain): portable car export format and builder"
```

---

### Task 2: Import route with cleanup

**Files:**
- Create: `apps/api/src/import-car-route.ts`, `apps/api/src/import-car-route.test.ts`
- Modify: `apps/api/src/router.ts`
- Modify: `infrastructure/cdk/lib/carlog-stack.ts`

**Interfaces:**
- Consumes: `CarExportSchema` (Task 1); `createCar`, `createEvent`, `createReminder`, repos.
- Produces: `handleImportCarRoute(deps: ImportCarDeps, event: ApiEvent, ownerId: string): Promise<ApiResult | null>` where `ImportCarDeps = { cars: CarRepository; events: EventRepository; reminders: ReminderRepository }`. Route: `POST /import/car` → 201 `Car`.

- [ ] **Step 1: Failing route test**

Create `apps/api/src/import-car-route.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Car } from '@carlog/contracts';
import { InMemoryCarRepository } from './in-memory-car-repository';
import { InMemoryEventRepository } from './in-memory-event-repository';
import { InMemoryReminderRepository } from './in-memory-reminder-repository';
import { handleImportCarRoute, type ImportCarDeps } from './import-car-route';
import type { ApiEvent } from './router';

const OWNER = 'owner-1';

const file = {
  format: 'carlog-car', version: 1, exportedAt: '2026-08-06T10:00:00.000Z',
  attachments: 'not-included',
  car: { make: 'VW', model: 'Golf', year: 2018, mileage: 92000, fuelType: 'diesel' },
  events: [
    { date: '2024-02-01', mileage: 84000, cost: 3000, currency: 'UAH', category: 'brakes', works: [] },
    { date: '2023-06-01', mileage: 70000, cost: 1200, currency: 'UAH', category: 'oil_change', works: [] },
  ],
  reminders: [{ title: 'Oil', category: 'oil_change', dueMileage: 100000 }],
};

const post = (body: unknown): ApiEvent => ({
  method: 'POST', path: '/import/car', ownerId: OWNER, groups: [],
  pathParams: {}, queryParams: {}, body,
});

describe('POST /import/car', () => {
  let deps: ImportCarDeps;
  beforeEach(() => {
    deps = {
      cars: new InMemoryCarRepository(),
      events: new InMemoryEventRepository(),
      reminders: new InMemoryReminderRepository(),
    };
  });

  it('creates the car with all events and reminders', async () => {
    const res = await handleImportCarRoute(deps, post(file), OWNER);
    expect(res?.statusCode).toBe(201);
    const car = JSON.parse(res!.body) as Car;
    expect(car.make).toBe('VW');
    expect(car.mileage).toBe(92000); // from the file, not derived
    expect(car.ownerId).toBe(OWNER);
    expect(car.shared).toBe(false);
    expect(await deps.events.listByCar(OWNER, car.id)).toHaveLength(2);
    expect(await deps.reminders.listByCar(OWNER, car.id)).toHaveLength(1);
  });

  it('rejects a wrong version with 400 and creates nothing', async () => {
    const res = await handleImportCarRoute(deps, post({ ...file, version: 2 }), OWNER);
    expect(res?.statusCode).toBe(400);
    expect(await deps.cars.listByOwner(OWNER)).toHaveLength(0);
  });

  it('cleans up everything when an event write fails mid-import', async () => {
    const failing = vi.spyOn(deps.events, 'create')
      .mockResolvedValueOnce({} as never) // first event succeeds (return value unused)
      .mockRejectedValueOnce(new Error('dynamo down'));
    await expect(handleImportCarRoute(deps, post(file), OWNER)).rejects.toThrow('dynamo down');
    expect(await deps.cars.listByOwner(OWNER)).toHaveLength(0); // no half-imported car
    failing.mockRestore();
  });

  it('cleans up when a reminder write fails after all events succeeded', async () => {
    vi.spyOn(deps.reminders, 'create').mockRejectedValueOnce(new Error('boom'));
    await expect(handleImportCarRoute(deps, post(file), OWNER)).rejects.toThrow('boom');
    expect(await deps.cars.listByOwner(OWNER)).toHaveLength(0);
  });

  it('returns null for non-matching paths', async () => {
    const res = await handleImportCarRoute(deps, { ...post(file), path: '/import/jobs' }, OWNER);
    expect(res).toBeNull();
  });
});
```

Note on the first-event mock: `create` returns the created event in the real repo; the
route must not depend on that return value for cleanup — it should track the IDs it
GENERATED. If your implementation tracks generated events itself, replace the
`mockResolvedValueOnce({} as never)` hack with a call-through spy that fails only on the
second invocation (`.mockImplementationOnce(original)` style). Adapt the test to the
implementation's real observability — but the ASSERTIONS (rejects + zero cars left) are
non-negotiable.

- [ ] **Step 2: Run to fail**

Run: `pnpm --filter @carlog/api test src/import-car-route.test.ts`
Expected: FAIL — cannot resolve `./import-car-route`.

- [ ] **Step 3: Implement the route**

Create `apps/api/src/import-car-route.ts`:

```ts
import { CarExportSchema } from '@carlog/contracts';
import {
  createCar, createEvent, createReminder,
  type CarRepository, type EventRepository, type ReminderRepository,
} from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import type { ApiEvent } from './router';

export type ImportCarDeps = {
  cars: CarRepository;
  events: EventRepository;
  reminders: ReminderRepository;
};

// POST /import/car — recreate a car from a CarLog export file as a NEW car.
// Handles only that path; returns null otherwise.
//
// Creation order: car → events → reminders, all server-side (no per-item HTTP). If any
// write fails, everything created so far is deleted (reminders, events, then the car) and
// the error rethrown — a half-imported car must never remain in the garage, and a retry
// of the whole import is then safe. Car mileage comes from the file verbatim.
export async function handleImportCarRoute(
  deps: ImportCarDeps, event: ApiEvent, ownerId: string,
): Promise<ApiResult | null> {
  if (event.path !== '/import/car' || event.method !== 'POST') return null;

  const file = CarExportSchema.parse(event.body); // ZodError → 400 via withErrorHandling

  const car = await deps.cars.create(createCar(ownerId, file.car));
  const createdEventIds: string[] = [];
  const createdReminderIds: string[] = [];
  try {
    for (const input of file.events) {
      const created = await deps.events.create(createEvent(ownerId, car.id, input));
      createdEventIds.push(created.id);
    }
    for (const input of file.reminders) {
      const created = await deps.reminders.create(createReminder(ownerId, car.id, input));
      createdReminderIds.push(created.id);
    }
  } catch (err) {
    // Best-effort cleanup, most-recent phase first. Deletes are idempotent; if one throws
    // we still attempt the rest, and the car delete last (its absence is what hides any
    // stragglers from every list view, which queries by car).
    for (const id of createdReminderIds) {
      await deps.reminders.delete(ownerId, car.id, id).catch(() => undefined);
    }
    for (const id of createdEventIds) {
      await deps.events.delete(ownerId, car.id, id).catch(() => undefined);
    }
    await deps.cars.delete(ownerId, car.id).catch(() => undefined);
    throw err;
  }

  return ok(201, car);
}
```

- [ ] **Step 4: Wire the router**

In `apps/api/src/router.ts`: import `handleImportCarRoute`; add the dispatch **before**
the existing `path.startsWith('/import/')` job branch (order matters — `/import/car`
would otherwise be swallowed by the job route's prefix match):

```ts
    if (path === '/import/car') {
      const result = await handleImportCarRoute(
        { cars: deps.cars, events: deps.events, reminders: deps.reminders },
        event, ownerId,
      );
      if (result) return result;
    }
```

- [ ] **Step 5: CDK route**

In `infrastructure/cdk/lib/carlog-stack.ts`, next to the existing `/import/...` routes:

```ts
    httpApi.addRoutes({ path: '/import/car', methods: [HttpMethod.POST], integration, authorizer });
```

- [ ] **Step 6: Run to pass, then gates**

Run: `pnpm --filter @carlog/api test src/import-car-route.test.ts` → PASS (5 cases).
Run: `pnpm turbo run build lint typecheck test` → green.
Run: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth > /dev/null && echo SYNTH_OK` → SYNTH_OK.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/import-car-route.ts apps/api/src/import-car-route.test.ts apps/api/src/router.ts infrastructure/cdk/lib/carlog-stack.ts
git commit -m "feat(api): import a car from a CarLog export file"
```

---

### Task 3: Web — export menu item + import dialog

**Files:**
- Create: `apps/web/src/lib/download-json.ts`
- Create: `apps/web/src/components/ImportCarDialog.tsx`
- Modify: `apps/web/src/routes/Vehicle.tsx`
- Modify: `apps/web/src/routes/Garage.tsx`
- Modify: `apps/web/src/api-client.ts`, `apps/web/src/queries.ts`
- Modify: `apps/web/src/i18n/locales/{en,uk}/vehicle.json`, `{en,uk}/garage.json`

**Interfaces:**
- Consumes: `toCarExport` (Task 1 — but see note below), `CarExportSchema`, `CarExport`; route (Task 2).
- Produces: `downloadJson(filename: string, data: unknown): void`; `importCar(token, file: CarExport): Promise<Car>`; `useImportCar()`; `<ImportCarDialog open onClose />`.

**Note:** `packages/domain` is not imported by the web app anywhere (it isn't browser-safe
— `node:crypto`). Check `apps/web/package.json`: if `@carlog/domain` is absent from its
dependencies, do NOT add it. Instead the web app re-derives the export object through a
small local mapper that produces `CarExport` and validates with `CarExportSchema.parse`
before download — put it in `apps/web/src/lib/car-export.ts` mirroring `toCarExport`'s
mapping with a comment noting the mirror (same convention as `reminder-view.ts`). The
domain `toCarExport` remains the tested reference implementation; the round-trip guarantee
on the web side comes from the `CarExportSchema.parse` call before download.

- [ ] **Step 1: i18n keys**

`apps/web/src/i18n/locales/en/vehicle.json` — add: `"exportHistory": "Export history"`.
`apps/web/src/i18n/locales/uk/vehicle.json` — add: `"exportHistory": "Експортувати історію"`.

`apps/web/src/i18n/locales/en/garage.json` — add:

```json
  "importCar": "Import car",
  "importTitle": "Import a car",
  "importPick": "Choose a CarLog export file (.json)",
  "importPreview": "{{make}} {{model}} · {{events}} records · {{reminders}} reminders",
  "importExportedAt": "Exported {{date}}",
  "importAction": "Import",
  "importBadFile": "This is not a CarLog export file.",
  "importNewerVersion": "This file was made by a newer version of CarLog.",
  "importFailed": "Import failed. Nothing was created — try again."
```

`apps/web/src/i18n/locales/uk/garage.json` — add:

```json
  "importCar": "Імпортувати авто",
  "importTitle": "Імпорт авто",
  "importPick": "Оберіть файл експорту CarLog (.json)",
  "importPreview": "{{make}} {{model}} · записів: {{events}} · нагадувань: {{reminders}}",
  "importExportedAt": "Експортовано {{date}}",
  "importAction": "Імпортувати",
  "importBadFile": "Це не файл експорту CarLog.",
  "importNewerVersion": "Цей файл створено новішою версією CarLog.",
  "importFailed": "Не вдалося імпортувати. Нічого не створено — спробуйте ще раз."
```

- [ ] **Step 2: Download helper + export mapper**

Create `apps/web/src/lib/download-json.ts`:

```ts
// Trigger a client-side download of `data` as pretty-printed JSON. Object URL is
// revoked after the click so repeated exports don't leak blobs.
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// carlog-<make>-<model>-<YYYY-MM-DD>.json, lowercased, non-alphanumerics dashed.
export function exportFilename(make: string, model: string, dateISO: string): string {
  const slug = `${make}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `carlog-${slug}-${dateISO}.json`;
}
```

Create `apps/web/src/lib/car-export.ts` per the Note above (mirror of domain
`toCarExport`, ending in `return CarExportSchema.parse(file);` so an invalid export can
never be downloaded).

- [ ] **Step 3: Export menu item on Vehicle**

In `apps/web/src/routes/Vehicle.tsx`, in the car-actions `Menu` (around line 322, read the
existing items), add between Share and Delete:

```tsx
                    <MenuItem onClick={() => { setMenuAnchor(null); onExport(); }}>
                      <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
                      <ListItemText>{t('vehicle:exportHistory')}</ListItemText>
                    </MenuItem>
```

with:

```tsx
  const onExport = () => {
    if (!car.data || !events.data || !reminders.data) return;
    const today = new Date().toISOString().slice(0, 10);
    const file = buildCarExport(car.data, events.data, reminders.data, new Date().toISOString());
    downloadJson(exportFilename(car.data.make, car.data.model, today), file);
  };
```

(`buildCarExport` is the local mirror's exported name; check what data hooks the page
actually uses — `car.data`/`events.data`/`reminders.data` names must match the file's
real query variables. If reminders aren't fetched outside the reminders tab, add the
`useReminders(id)` hook call — it's cheap and cached.)

- [ ] **Step 4: Import client + hook**

`apps/web/src/api-client.ts`:

```ts
export const importCar = (token: string, file: CarExport): Promise<Car> =>
  request(token, '/import/car', CarSchema, { method: 'POST', body: JSON.stringify(file) });
```

(add `CarExport` to the contracts type import list).

`apps/web/src/queries.ts`:

```ts
export function useImportCar() {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: CarExport) => importCar(token, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars'] }),
  });
}
```

- [ ] **Step 5: Import dialog**

Create `apps/web/src/components/ImportCarDialog.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Typography } from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { CarExportSchema, CAR_EXPORT_FORMAT, type CarExport } from '@carlog/contracts';
import { Modal } from './ui/Modal';
import { useImportCar } from '../queries';
import { formatDate } from '../i18n/format';

type ParseResult =
  | { kind: 'ok'; file: CarExport }
  | { kind: 'badFile' }
  | { kind: 'newerVersion' };

// Distinguish "not our file at all" from "our file, newer version" so the error
// message can tell the user to update instead of blaming the file.
function parseExport(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { kind: 'badFile' }; }
  const parsed = CarExportSchema.safeParse(raw);
  if (parsed.success) return { kind: 'ok', file: parsed.data };
  const looksOurs = typeof raw === 'object' && raw !== null
    && (raw as { format?: unknown }).format === CAR_EXPORT_FORMAT;
  const newer = looksOurs && typeof (raw as { version?: unknown }).version === 'number'
    && ((raw as { version: number }).version > 1);
  return newer ? { kind: 'newerVersion' } : { kind: 'badFile' };
}

export function ImportCarDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation(['garage', 'common']);
  const navigate = useNavigate();
  const importCar = useImportCar();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<CarExport | null>(null);
  const [error, setError] = useState<'badFile' | 'newerVersion' | 'failed' | null>(null);

  const reset = () => { setPicked(null); setError(null); };
  const close = () => { reset(); onClose(); };

  const onPick = async (fl: FileList | null) => {
    reset();
    const f = fl?.[0];
    if (!f) return;
    const result = parseExport(await f.text());
    if (result.kind === 'ok') setPicked(result.file);
    else setError(result.kind);
  };

  const doImport = async () => {
    if (!picked) return;
    try {
      const car = await importCar.mutateAsync(picked);
      close();
      navigate(`/cars/${car.id}`);
    } catch {
      setError('failed');
    }
  };

  return (
    <Modal open={open} onClose={importCar.isPending ? undefined : close} title={t('garage:importTitle')}
      actions={
        <>
          <Button onClick={close} disabled={importCar.isPending}>{t('common:cancel')}</Button>
          <Button variant="contained" onClick={() => void doImport()}
            disabled={!picked || importCar.isPending}>
            {t('garage:importAction')}
          </Button>
        </>
      }>
      <Stack spacing={2} sx={{ pt: 0.5 }}>
        {error ? (
          <Alert severity={error === 'failed' ? 'error' : 'warning'}>
            {t(`garage:import${error === 'badFile' ? 'BadFile' : error === 'newerVersion' ? 'NewerVersion' : 'Failed'}`)}
          </Alert>
        ) : null}
        <input ref={inputRef} type="file" accept="application/json,.json" hidden
          onChange={(e) => { void onPick(e.target.files); e.target.value = ''; }} />
        <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />}
          onClick={() => inputRef.current?.click()} disabled={importCar.isPending}>
          {t('garage:importPick')}
        </Button>
        {picked ? (
          <Stack spacing={0.5}>
            <Typography sx={{ fontWeight: 600 }}>
              {t('garage:importPreview', {
                make: picked.car.make, model: picked.car.model,
                events: picked.events.length, reminders: picked.reminders.length,
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('garage:importExportedAt', { date: formatDate(picked.exportedAt, i18n.language) })}
            </Typography>
          </Stack>
        ) : null}
      </Stack>
    </Modal>
  );
}
```

- [ ] **Step 6: Garage entry**

In `apps/web/src/routes/Garage.tsx`: add state `const [importOpen, setImportOpen] = useState(false);`,
render `<ImportCarDialog open={importOpen} onClose={() => setImportOpen(false)} />`, and add
the entry point. Read the page: the empty state has an add Button and the header/FAB add
a car — put a secondary `Button variant="text" startIcon={<UploadFileOutlinedIcon />}`
with `t('garage:importCar')` next to the empty-state add button AND a small
`IconButton` (same icon, `aria-label={t('garage:importCar')}`) in the page header actions
if the header supports actions — match the page's existing structure; if there is no
header actions slot, the empty-state button plus a text button above the grid suffices.

- [ ] **Step 7: Gates + commit**

Run: `pnpm turbo run build lint typecheck test` → green.

```bash
git add apps/web/src/lib/download-json.ts apps/web/src/lib/car-export.ts apps/web/src/components/ImportCarDialog.tsx apps/web/src/routes/Vehicle.tsx apps/web/src/routes/Garage.tsx apps/web/src/api-client.ts apps/web/src/queries.ts apps/web/src/i18n/locales/en/vehicle.json apps/web/src/i18n/locales/uk/vehicle.json apps/web/src/i18n/locales/en/garage.json apps/web/src/i18n/locales/uk/garage.json
git commit -m "feat(web): export car history and import as new car"
```

---

### Task 4: Merge, deploy, verify

**Files:**
- Modify: `carlog-docs/API.md` — add `POST /import/car` under a new "Import" heading (or next to the existing import routes if documented).

- [ ] **Step 1: All gates**

Run: `pnpm turbo run build lint typecheck test` → 18/18.

- [ ] **Step 2: Docs + commit**

Add to `carlog-docs/API.md`:

```
POST /import/car        # recreate a car (with events + reminders) from a CarLog export file
```

```bash
git add carlog-docs/API.md
git commit -m "docs: import/export car route"
```

- [ ] **Step 3: Merge + deploy (backend + web)**

```bash
git checkout main && git merge --no-ff feat/export-import-history -m "feat: export/import car history"
AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never
AWS_PROFILE=yevhenii ./scripts/deploy-web.sh
```

- [ ] **Step 4: Live verification**

API-level: unauthenticated `POST {ApiUrl}/import/car` → 401 (route registered).
User: export Галя from the Vehicle menu → the JSON downloads; import it in the Garage →
preview shows the counts → Import → a duplicate car appears with the full timeline and
reminders; delete the duplicate afterwards.

---

## Notes for the implementer

- The web mirror (`apps/web/src/lib/car-export.ts`) exists because `packages/domain` is
  not browser-safe; the `CarExportSchema.parse` before download is the correctness
  backstop. If domain IS importable in the web build (check first), use `toCarExport`
  directly and skip the mirror.
- Router dispatch order: `/import/car` must be checked BEFORE the `/import/` prefix
  branches (`/import/scan`, `/import/jobs`).
- Cleanup deletes are best-effort (`.catch(() => undefined)`) — the car delete goes LAST
  so list views (which query by car) never show stragglers.
