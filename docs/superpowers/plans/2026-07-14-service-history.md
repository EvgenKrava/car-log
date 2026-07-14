# Full Service History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-car structured service book — Events (date/mileage/cost/category) containing Works that list Parts, plus PDF/image proof attachments — shown as a reverse-chronological timeline on the Vehicle page.

**Architecture:** Event-as-document in the existing single DynamoDB table (`SK=CAR#<carId>#EVENT#<id>`, works/parts embedded JSON); proofs are separate leaf rows (`...#EVENT#<id>#PROOF#<pid>`) reusing the photo pre-signed-S3 infra. Backend: `EventRepository`/`ProofRepository` on the existing JWT-authorized Lambda; frontend: a `ServiceTimeline` on the Vehicle page with a nested Works/Parts form. Collision-proof list queries filter nested rows in code (the cars-vs-photos lesson).

**Tech Stack:** TypeScript (strict), Zod, AWS SDK v3 (lib-dynamodb, client-s3, s3-request-presigner — already deps), React 18 + MUI v6 + TanStack Query + react-hook-form (`useFieldArray`), react-i18next, Vitest, AWS CDK v2.

## Global Constraints

- Frontend/backend only; NO contracts-breaking or CDK-resource change (routes are added to the existing HTTP API + Lambda; the photos S3 bucket is reused for proofs).
- Strict TS, never `any`. Zod = source of truth; types via `z.infer`. `interface` only for ports.
- Extensionless relative imports. MUI only on frontend. i18n via react-i18next; all user strings translated EN + UK.
- **Event-as-document:** one item per Event with `works: Work[]` (each `Work` has `parts: PartUsage[]`) embedded. PUT is **full-replace** preserving id/carId/ownerId/createdAt.
- **SK collision rule (mandatory):** `begins_with` list queries must exclude nested rows IN CODE (DynamoDB forbids FilterExpression on the SK key attribute). `EventRepository.listByCar`: `begins_with(SK,"CAR#<carId>#EVENT#")` then drop SKs containing `#PROOF#`.
- **Owner-scoping (IDOR-safe):** ownerId from JWT `sub`; `requireCar` verifies ownership; all SKs owner+car scoped.
- **Proof infra reuse:** reuse the existing `S3PhotoStorage` adapter (content-type-agnostic) + the presign→PUT→confirm flow. Carry forward ALL photo final-review fixes: confirm uses the PRESIGNED id (not a fresh uuid); presignPut does NOT sign ContentLength; cap checked on confirm; S3 existence-check (HeadObject) on confirm.
- Limits: `MAX_WORKS_PER_EVENT=30`, `MAX_PARTS_PER_WORK=30`, `MAX_PROOF_SIZE=10_485_760`, `MAX_PROOFS_PER_EVENT=20`. Attachment content types: image/jpeg,png,webp,heic + application/pdf.
- SW must not cache API: after web build `grep -c execute-api dist/sw.js == 0`.
- Do NOT modify `validate-photo.ts` or PhotoGallery's use of it — add a NEW `validate-attachment.ts`.
- Conventional commits; NO co-authorship trailers. AWS profile `yevhenii`, region `us-east-1`.

## File Structure

```
packages/contracts/src/event.ts / event.test.ts   CREATE  Event/Work/Part/category schemas + consts (T1)
packages/contracts/src/proof.ts                    CREATE  Proof schema + attachment content types (T1)
packages/contracts/src/index.ts                    MODIFY  export event, proof (T1)
packages/domain/src/event.ts / event.test.ts       CREATE  createEvent + EventNotFoundError (T2)
packages/domain/src/event-repository.ts            CREATE  EventRepository port (T2)
packages/domain/src/proof-repository.ts            CREATE  ProofRepository port (T2)
packages/domain/src/index.ts                       MODIFY  (T2)
apps/api/src/event-key.ts / event-key.test.ts      CREATE  eventSk, isEventRow filter, proofKey, assertUnderCap (T3)
apps/api/src/in-memory-event-repository.ts         CREATE  SK-keyed fake (exercises #PROOF# filter) (T3)
apps/api/src/in-memory-proof-repository.ts         CREATE  (T3)
apps/api/src/event-routes.ts                       CREATE  event CRUD + cascade delete + proof sub-routes (T4)
apps/api/src/router.ts                             MODIFY  RouteDeps += events,proofs; dispatch /events* (T4)
apps/api/src/router.test.ts                        MODIFY  event + proof route tests (T4)
apps/api/src/dynamo-event-repository.ts            CREATE  (T5)
apps/api/src/dynamo-proof-repository.ts            CREATE  (T5)
apps/api/src/handler.ts                            MODIFY  build event/proof repos (T5)
infrastructure/cdk/lib/carlog-stack.ts             MODIFY  register /cars/{id}/events* routes (T6)
apps/web/src/api-client.ts                         MODIFY  events + proofs client fns (T7)
apps/web/src/queries.ts                            MODIFY  event + proof hooks (T7)
apps/web/src/lib/validate-attachment.ts / test     CREATE  image+PDF validation (T7)
apps/web/src/i18n/locales/{en,uk}/event.json       CREATE  event namespace incl category_* (T8)
apps/web/src/i18n/index.ts                         MODIFY  register 'event' ns (T8)
apps/web/src/components/EventFormDialog.tsx        CREATE  nested works/parts form (T9)
apps/web/src/components/EventCard.tsx              CREATE  collapsed/expanded event card (T10)
apps/web/src/components/ProofList.tsx              CREATE  proof upload/thumbnail/pdf-card (T10)
apps/web/src/components/ServiceTimeline.tsx        CREATE  timeline section (T11)
apps/web/src/routes/Vehicle.tsx                    MODIFY  render <ServiceTimeline/> (T11)
```

Order: contracts (1) → domain (2) → api helpers+fakes (3) → routes+router w/ fakes (4) → dynamo/S3+handler (5) → CDK (6) → web data layer (7) → i18n (8) → event form (9) → card+proofs (10) → timeline wiring (11) → verify+deploy (12).

---

### Task 1: Contracts — Event/Work/Part + Proof schemas

**Files:** Create `packages/contracts/src/event.ts`, `event.test.ts`, `proof.ts`; Modify `index.ts`.

**Interfaces:**
- Produces consts `EVENT_CATEGORIES`, `MAX_WORKS_PER_EVENT`, `MAX_PARTS_PER_WORK`, `ATTACHMENT_CONTENT_TYPES`, `MAX_PROOF_SIZE`, `MAX_PROOFS_PER_EVENT`; schemas `PartUsageSchema`, `WorkSchema`, `EventCategorySchema`, `EventSchema`, `CreateEventSchema`, `ProofSchema`, `ProofPresignRequestSchema`, `ProofPresignResponseSchema`, `ProofWithUrlSchema`; types `PartUsage`, `Work`, `EventCategory`, `Event`, `CreateEventInput`, `Proof`, `ProofWithUrl`, `AttachmentContentType`.

- [ ] **Step 1: Write the failing test — `packages/contracts/src/event.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { CreateEventSchema, WorkSchema } from './event';

const validEvent = {
  date: '2026-07-14', mileage: 120000, cost: 1500, currency: 'UAH', category: 'oil_change',
  works: [{ description: 'Oil & filter change', parts: [{ name: 'Oil filter', quantity: 1 }] }],
};

describe('CreateEventSchema', () => {
  it('accepts a valid nested event', () => {
    expect(CreateEventSchema.parse(validEvent)).toMatchObject({ category: 'oil_change' });
  });
  it('rejects an unknown category', () => {
    expect(() => CreateEventSchema.parse({ ...validEvent, category: 'spaceship' })).toThrow();
  });
  it('rejects negative mileage', () => {
    expect(() => CreateEventSchema.parse({ ...validEvent, mileage: -1 })).toThrow();
  });
  it('rejects a part with quantity < 1', () => {
    expect(() => CreateEventSchema.parse({ ...validEvent, works: [{ description: 'x', parts: [{ name: 'p', quantity: 0 }] }] })).toThrow();
  });
  it('rejects a part with a bad purchaseLink url', () => {
    expect(() => CreateEventSchema.parse({ ...validEvent, works: [{ description: 'x', parts: [{ name: 'p', quantity: 1, purchaseLink: 'not-a-url' }] }] })).toThrow();
  });
  it('normalizes empty-string optional part fields to undefined (empty purchaseLink is OK)', () => {
    const parsed = CreateEventSchema.parse({ ...validEvent, works: [{ description: 'x', parts: [{ name: 'p', quantity: 1, brand: '', partNumber: '', notes: '', purchaseLink: '' }] }] });
    const part = parsed.works[0].parts[0];
    expect(part.purchaseLink).toBeUndefined();
    expect(part.brand).toBeUndefined();
  });
  it('defaults works and currency', () => {
    const e = CreateEventSchema.parse({ date: '2026-07-14', mileage: 0, cost: 0, category: 'other' });
    expect(e.works).toEqual([]);
    expect(e.currency).toBe('UAH');
  });
});

describe('WorkSchema', () => {
  it('defaults parts to []', () => {
    expect(WorkSchema.parse({ description: 'Rotate tires' }).parts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/contracts test`
Expected: FAIL — cannot resolve `./event`.

- [ ] **Step 3: Create `packages/contracts/src/event.ts`**

```ts
import { z } from 'zod';

export const EVENT_CATEGORIES = ['oil_change', 'tires', 'brakes', 'inspection', 'repair', 'other'] as const;
export const MAX_WORKS_PER_EVENT = 30;
export const MAX_PARTS_PER_WORK = 30;

// Optional free-text/url fields: the form submits '' for empty inputs; match '' first
// (→ undefined) so an empty purchaseLink doesn't fail the .url() check. Same pattern as
// the car contracts' emptyToUndefined (learned from the blank-VIN bug).
const optText = (s: z.ZodString) => z.literal('').transform(() => undefined).or(s.optional());

export const PartUsageSchema = z.object({
  name: z.string().min(1).max(80),
  brand: optText(z.string().max(60)),
  partNumber: optText(z.string().max(60)),
  quantity: z.number().int().min(1),
  notes: optText(z.string().max(500)),
  purchaseLink: optText(z.string().url().max(500)),
});

export const WorkSchema = z.object({
  description: z.string().min(1).max(200),
  parts: z.array(PartUsageSchema).max(MAX_PARTS_PER_WORK).default([]),
});

export const EventCategorySchema = z.enum(EVENT_CATEGORIES);

export const CreateEventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  mileage: z.number().int().min(0),
  cost: z.number().min(0),
  currency: z.string().min(1).max(8).default('UAH'),
  category: EventCategorySchema,
  title: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  works: z.array(WorkSchema).max(MAX_WORKS_PER_EVENT).default([]),
});

export const EventSchema = CreateEventSchema.extend({
  id: z.string().uuid(),
  carId: z.string().uuid(),
  ownerId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PartUsage = z.infer<typeof PartUsageSchema>;
export type Work = z.infer<typeof WorkSchema>;
export type EventCategory = z.infer<typeof EventCategorySchema>;
export type Event = z.infer<typeof EventSchema>;
export type CreateEventInput = z.infer<typeof CreateEventSchema>;
```

- [ ] **Step 4: Create `packages/contracts/src/proof.ts`**

```ts
import { z } from 'zod';

export const ATTACHMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const MAX_PROOF_SIZE = 10_485_760; // 10 MB
export const MAX_PROOFS_PER_EVENT = 20;

export const AttachmentContentTypeSchema = z.enum(ATTACHMENT_CONTENT_TYPES);

export const ProofPresignRequestSchema = z.object({
  contentType: AttachmentContentTypeSchema,
  size: z.number().int().min(1).max(MAX_PROOF_SIZE),
  filename: z.string().min(1).max(200).optional(),
});

export const ProofSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  carId: z.string().uuid(),
  ownerId: z.string().min(1),
  contentType: AttachmentContentTypeSchema,
  size: z.number().int().min(1).max(MAX_PROOF_SIZE),
  filename: z.string().max(200).optional(),
  createdAt: z.string().datetime(),
});

export const ProofConfirmSchema = ProofPresignRequestSchema.extend({ proofId: z.string().uuid() });
export const ProofPresignResponseSchema = z.object({ proofId: z.string().uuid(), uploadUrl: z.string().url(), key: z.string().min(1) });
export const ProofWithUrlSchema = ProofSchema.extend({ url: z.string().url() });

export type AttachmentContentType = z.infer<typeof AttachmentContentTypeSchema>;
export type ProofPresignRequest = z.infer<typeof ProofPresignRequestSchema>;
export type Proof = z.infer<typeof ProofSchema>;
export type ProofConfirm = z.infer<typeof ProofConfirmSchema>;
export type ProofPresignResponse = z.infer<typeof ProofPresignResponseSchema>;
export type ProofWithUrl = z.infer<typeof ProofWithUrlSchema>;
```

- [ ] **Step 5: Export from `packages/contracts/src/index.ts`**

Add after the existing exports:

```ts
export * from './event';
export * from './proof';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @carlog/contracts test`
Expected: PASS (existing + 7 new event tests).

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/event.ts packages/contracts/src/event.test.ts packages/contracts/src/proof.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add Event/Work/Part and Proof schemas"
```

---

### Task 2: Domain — createEvent + Event/Proof ports

**Files:** Create `packages/domain/src/event.ts`, `event.test.ts`, `event-repository.ts`, `proof-repository.ts`; Modify `index.ts`.

**Interfaces:**
- Consumes: `CreateEventSchema`, `Event`, `CreateEventInput`, `Proof` from `@carlog/contracts`.
- Produces:
  - `createEvent(ownerId, carId, input, deps?: { newId?; now? }): Event`
  - `class EventNotFoundError extends Error`, `class ProofNotFoundError extends Error`
  - `interface EventRepository { create(e: Event): Promise<Event>; listByCar(ownerId, carId): Promise<Event[]>; getById(ownerId, carId, eventId): Promise<Event | null>; update(ownerId, carId, eventId, input: CreateEventInput): Promise<Event>; delete(ownerId, carId, eventId): Promise<void>; }`
  - `interface ProofRepository { create(p: Proof): Promise<Proof>; listByEvent(ownerId, carId, eventId): Promise<Proof[]>; getById(ownerId, carId, eventId, proofId): Promise<Proof | null>; delete(ownerId, carId, eventId, proofId): Promise<void>; }`

- [ ] **Step 1: Write the failing test — `packages/domain/src/event.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createEvent } from './event';

const deps = { newId: () => 'evt-id', now: () => '2026-07-14T00:00:00.000Z' };
const input = { date: '2026-07-14', mileage: 1000, cost: 500, category: 'repair' as const };

describe('createEvent', () => {
  it('assigns id/carId/ownerId/timestamps and defaults', () => {
    const e = createEvent('u1', '11111111-1111-1111-1111-111111111111', input, deps);
    expect(e).toMatchObject({ id: 'evt-id', ownerId: 'u1', carId: '11111111-1111-1111-1111-111111111111', category: 'repair', currency: 'UAH' });
    expect(e.works).toEqual([]);
    expect(e.createdAt).toBe('2026-07-14T00:00:00.000Z');
  });
  it('rejects invalid input', () => {
    expect(() => createEvent('u1', '11111111-1111-1111-1111-111111111111', { ...input, mileage: -5 }, deps)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/domain test`
Expected: FAIL — cannot resolve `./event`.

- [ ] **Step 3: Create `packages/domain/src/event.ts`**

```ts
import { CreateEventSchema, type Event, type CreateEventInput } from '@carlog/contracts';
import { newId as defaultNewId, nowIso } from './id';

export type CreateEventDeps = { newId?: () => string; now?: () => string };

export function createEvent(
  ownerId: string, carId: string, input: CreateEventInput, deps: CreateEventDeps = {},
): Event {
  const data = CreateEventSchema.parse(input);
  const timestamp = (deps.now ?? nowIso)();
  return {
    ...data,
    id: (deps.newId ?? defaultNewId)(),
    carId,
    ownerId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export class EventNotFoundError extends Error {
  constructor(id: string) { super(`Event ${id} not found`); this.name = 'EventNotFoundError'; }
}
export class ProofNotFoundError extends Error {
  constructor(id: string) { super(`Proof ${id} not found`); this.name = 'ProofNotFoundError'; }
}
```

- [ ] **Step 4: Create `packages/domain/src/event-repository.ts`**

```ts
import type { Event, CreateEventInput } from '@carlog/contracts';

export interface EventRepository {
  create(event: Event): Promise<Event>;
  listByCar(ownerId: string, carId: string): Promise<Event[]>;
  getById(ownerId: string, carId: string, eventId: string): Promise<Event | null>;
  update(ownerId: string, carId: string, eventId: string, input: CreateEventInput): Promise<Event>;
  delete(ownerId: string, carId: string, eventId: string): Promise<void>;
}
```

- [ ] **Step 5: Create `packages/domain/src/proof-repository.ts`**

```ts
import type { Proof } from '@carlog/contracts';

export interface ProofRepository {
  create(proof: Proof): Promise<Proof>;
  listByEvent(ownerId: string, carId: string, eventId: string): Promise<Proof[]>;
  getById(ownerId: string, carId: string, eventId: string, proofId: string): Promise<Proof | null>;
  delete(ownerId: string, carId: string, eventId: string, proofId: string): Promise<void>;
}
```

- [ ] **Step 6: Export from `packages/domain/src/index.ts`**

```ts
export * from './event';
export * from './event-repository';
export * from './proof-repository';
```

- [ ] **Step 7: Run test + typecheck**

Run: `pnpm --filter @carlog/domain test && pnpm --filter @carlog/domain typecheck`
Expected: PASS (existing + 2 new); no AWS import in domain.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/event.ts packages/domain/src/event.test.ts packages/domain/src/event-repository.ts packages/domain/src/proof-repository.ts packages/domain/src/index.ts
git commit -m "feat(domain): add createEvent factory and Event/Proof repository ports"
```

---

### Task 3: API pure helpers + in-memory fakes (collision-proof filter)

**Files:** Create `apps/api/src/event-key.ts`, `event-key.test.ts`, `in-memory-event-repository.ts`, `in-memory-proof-repository.ts`.

**Interfaces:**
- Consumes: `MAX_PROOFS_PER_EVENT`, `Event`, `Proof` from `@carlog/contracts`; `CapExceededError` (existing), `EventNotFoundError`, `EventRepository`, `ProofRepository` from `@carlog/domain`.
- Produces:
  - `eventSk(carId, eventId): string` → `CAR#<carId>#EVENT#<eventId>`
  - `proofSk(carId, eventId, proofId): string` → `CAR#<carId>#EVENT#<eventId>#PROOF#<proofId>`
  - `proofKey(ownerId, carId, eventId, proofId): string` → `proofs/<ownerId>/<carId>/<eventId>/<proofId>`
  - `isEventRow(sk: string): boolean` → true iff SK is an event (contains `#EVENT#` but NOT `#PROOF#`)
  - `assertProofUnderCap(count: number): void` → throws `CapExceededError` at `MAX_PROOFS_PER_EVENT`
  - `InMemoryEventRepository`, `InMemoryProofRepository`

- [ ] **Step 1: Write the failing test — `apps/api/src/event-key.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { eventSk, proofSk, proofKey, isEventRow, assertProofUnderCap } from './event-key';
import { CapExceededError } from '@carlog/domain';
import { MAX_PROOFS_PER_EVENT } from '@carlog/contracts';

describe('keys', () => {
  it('builds event and proof SKs and the proof S3 key', () => {
    expect(eventSk('c1', 'e1')).toBe('CAR#c1#EVENT#e1');
    expect(proofSk('c1', 'e1', 'p1')).toBe('CAR#c1#EVENT#e1#PROOF#p1');
    expect(proofKey('u1', 'c1', 'e1', 'p1')).toBe('proofs/u1/c1/e1/p1');
  });
});

describe('isEventRow (collision guard)', () => {
  it('is true for an event SK', () => { expect(isEventRow('CAR#c1#EVENT#e1')).toBe(true); });
  it('is false for a proof SK under an event', () => { expect(isEventRow('CAR#c1#EVENT#e1#PROOF#p1')).toBe(false); });
});

describe('assertProofUnderCap', () => {
  it('allows under the cap', () => { expect(() => assertProofUnderCap(MAX_PROOFS_PER_EVENT - 1)).not.toThrow(); });
  it('throws at the cap', () => { expect(() => assertProofUnderCap(MAX_PROOFS_PER_EVENT)).toThrow(CapExceededError); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/api test`
Expected: FAIL — cannot resolve `./event-key`.

- [ ] **Step 3: Create `apps/api/src/event-key.ts`**

```ts
import { MAX_PROOFS_PER_EVENT } from '@carlog/contracts';
import { CapExceededError } from '@carlog/domain';

export const eventSk = (carId: string, eventId: string): string => `CAR#${carId}#EVENT#${eventId}`;
export const proofSk = (carId: string, eventId: string, proofId: string): string =>
  `CAR#${carId}#EVENT#${eventId}#PROOF#${proofId}`;
export const proofKey = (ownerId: string, carId: string, eventId: string, proofId: string): string =>
  `proofs/${ownerId}/${carId}/${eventId}/${proofId}`;

// An event row's SK contains "#EVENT#" but must NOT be a nested proof row.
export const isEventRow = (sk: string): boolean => sk.includes('#EVENT#') && !sk.includes('#PROOF#');

export function assertProofUnderCap(count: number): void {
  if (count >= MAX_PROOFS_PER_EVENT) throw new CapExceededError();
}
```

- [ ] **Step 4: Create `apps/api/src/in-memory-event-repository.ts`** (single SK-keyed map so the filter is exercised)

```ts
import type { Event, CreateEventInput } from '@carlog/contracts';
import { EventNotFoundError, type EventRepository } from '@carlog/domain';
import { eventSk, isEventRow } from './event-key';

export class InMemoryEventRepository implements EventRepository {
  // key: `${ownerId}|${SK}` → Event. One map, SK-shaped, so isEventRow filtering matters.
  private rows = new Map<string, Event>();
  private k(ownerId: string, sk: string) { return `${ownerId}|${sk}`; }

  async create(event: Event): Promise<Event> {
    this.rows.set(this.k(event.ownerId, eventSk(event.carId, event.id)), event);
    return event;
  }
  async listByCar(ownerId: string, carId: string): Promise<Event[]> {
    const prefix = `CAR#${carId}#EVENT#`;
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(`${ownerId}|`))
      .map(([key, e]) => [key.slice(ownerId.length + 1), e] as const)
      .filter(([sk]) => sk.startsWith(prefix) && isEventRow(sk))
      .map(([, e]) => e);
  }
  async getById(ownerId: string, carId: string, eventId: string): Promise<Event | null> {
    return this.rows.get(this.k(ownerId, eventSk(carId, eventId))) ?? null;
  }
  async update(ownerId: string, carId: string, eventId: string, input: CreateEventInput): Promise<Event> {
    const existing = this.rows.get(this.k(ownerId, eventSk(carId, eventId)));
    if (!existing) throw new EventNotFoundError(eventId);
    const updated: Event = { ...input, id: existing.id, carId, ownerId, createdAt: existing.createdAt, updatedAt: new Date().toISOString(), currency: input.currency ?? 'UAH', works: input.works ?? [] };
    this.rows.set(this.k(ownerId, eventSk(carId, eventId)), updated);
    return updated;
  }
  async delete(ownerId: string, carId: string, eventId: string): Promise<void> {
    this.rows.delete(this.k(ownerId, eventSk(carId, eventId)));
  }
}
```

- [ ] **Step 5: Create `apps/api/src/in-memory-proof-repository.ts`**

```ts
import type { Proof } from '@carlog/contracts';
import { type ProofRepository } from '@carlog/domain';

export class InMemoryProofRepository implements ProofRepository {
  private proofs = new Map<string, Proof>();
  private k(o: string, c: string, e: string, p: string) { return `${o}#${c}#${e}#${p}`; }

  async create(proof: Proof): Promise<Proof> {
    this.proofs.set(this.k(proof.ownerId, proof.carId, proof.eventId, proof.id), proof);
    return proof;
  }
  async listByEvent(ownerId: string, carId: string, eventId: string): Promise<Proof[]> {
    return [...this.proofs.values()].filter((p) => p.ownerId === ownerId && p.carId === carId && p.eventId === eventId);
  }
  async getById(ownerId: string, carId: string, eventId: string, proofId: string): Promise<Proof | null> {
    return this.proofs.get(this.k(ownerId, carId, eventId, proofId)) ?? null;
  }
  async delete(ownerId: string, carId: string, eventId: string, proofId: string): Promise<void> {
    this.proofs.delete(this.k(ownerId, carId, eventId, proofId));
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @carlog/api test`
Expected: PASS (existing + 5 new event-key tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/event-key.ts apps/api/src/event-key.test.ts apps/api/src/in-memory-event-repository.ts apps/api/src/in-memory-proof-repository.ts
git commit -m "feat(api): add event/proof key helpers, collision guard, and in-memory fakes"
```

---

### Task 4: Event + proof routes; router wiring (tested with fakes)

**Files:** Create `apps/api/src/event-routes.ts`; Modify `apps/api/src/router.ts`, `apps/api/src/router.test.ts`.

**Interfaces:**
- Consumes: `CreateEventSchema`, `ProofPresignRequestSchema`, `ProofConfirmSchema`, `MAX_PROOF_SIZE` from contracts; `createEvent`, `EventNotFoundError`, `ProofNotFoundError`, `CarNotFoundError`, `EventRepository`, `ProofRepository`, `PhotoStorage` from domain; `eventSk`, `proofKey`, `assertProofUnderCap` from `./event-key`; existing `ok`, `ApiResult`, `ApiEvent`, `RouteDeps`.
- Produces: `handleEventRoute(deps, event, ownerId, carId): Promise<ApiResult | null>`. `RouteDeps` extended with `events: EventRepository; proofs: ProofRepository` (storage already present).

- [ ] **Step 1: Create `apps/api/src/event-routes.ts`**

```ts
import { CreateEventSchema, ProofConfirmSchema, ProofPresignRequestSchema, MAX_PROOF_SIZE } from '@carlog/contracts';
import {
  CarNotFoundError, EventNotFoundError, ProofNotFoundError, createEvent,
  type EventRepository, type ProofRepository, type PhotoStorage, type CarRepository,
} from '@carlog/domain';
import { ok, type ApiResult } from './errors';
import { proofKey, assertProofUnderCap } from './event-key';
import type { ApiEvent } from './router';

export type EventDeps = {
  cars: CarRepository; events: EventRepository; proofs: ProofRepository; storage: PhotoStorage;
};

async function requireCar(deps: EventDeps, ownerId: string, carId: string) {
  const car = await deps.cars.getById(ownerId, carId);
  if (!car) throw new CarNotFoundError(carId);
}

async function requireEvent(deps: EventDeps, ownerId: string, carId: string, eventId: string) {
  const ev = await deps.events.getById(ownerId, carId, eventId);
  if (!ev) throw new EventNotFoundError(eventId);
}

// Handles /cars/{carId}/events* ; returns null if not matched.
export async function handleEventRoute(
  deps: EventDeps, event: ApiEvent, ownerId: string, carId: string,
): Promise<ApiResult | null> {
  const { method, path, pathParams, body } = event;
  const base = `/cars/${carId}/events`;
  const eventId = pathParams.eventId;
  const proofId = pathParams.proofId;

  // Proof sub-routes (checked before the event-item routes)
  if (eventId && path.startsWith(`${base}/${eventId}/proofs`)) {
    await requireCar(deps, ownerId, carId);
    await requireEvent(deps, ownerId, carId, eventId);
    const pbase = `${base}/${eventId}/proofs`;

    if (path === `${pbase}/presign` && method === 'POST') {
      const req = ProofPresignRequestSchema.parse(body);
      const existing = await deps.proofs.listByEvent(ownerId, carId, eventId);
      assertProofUnderCap(existing.length);
      const newProofId = crypto.randomUUID();
      const key = proofKey(ownerId, carId, eventId, newProofId);
      const uploadUrl = await deps.storage.presignPut(key, req.contentType, MAX_PROOF_SIZE);
      return ok(200, { proofId: newProofId, uploadUrl, key });
    }
    if (path === pbase && method === 'POST') {
      const req = ProofConfirmSchema.parse(body);
      const existing = await deps.proofs.listByEvent(ownerId, carId, eventId);
      assertProofUnderCap(existing.length);
      const key = proofKey(ownerId, carId, eventId, req.proofId);
      if (!(await deps.storage.exists(key))) throw new ProofNotFoundError(req.proofId);
      const proof = {
        id: req.proofId, eventId, carId, ownerId,
        contentType: req.contentType, size: req.size, filename: req.filename,
        createdAt: new Date().toISOString(),
      };
      return ok(201, await deps.proofs.create(proof));
    }
    if (path === pbase && method === 'GET') {
      const proofs = await deps.proofs.listByEvent(ownerId, carId, eventId);
      const withUrls = await Promise.all(
        proofs.map(async (p) => ({ ...p, url: await deps.storage.presignGet(proofKey(ownerId, carId, eventId, p.id)) })),
      );
      return ok(200, withUrls);
    }
    if (proofId && path === `${pbase}/${proofId}` && method === 'DELETE') {
      const proof = await deps.proofs.getById(ownerId, carId, eventId, proofId);
      if (!proof) throw new ProofNotFoundError(proofId);
      await deps.storage.deleteObject(proofKey(ownerId, carId, eventId, proofId));
      await deps.proofs.delete(ownerId, carId, eventId, proofId);
      return ok(204, null);
    }
    return null;
  }

  // Event-item routes
  if (path === base && method === 'GET') {
    await requireCar(deps, ownerId, carId);
    return ok(200, await deps.events.listByCar(ownerId, carId));
  }
  if (path === base && method === 'POST') {
    await requireCar(deps, ownerId, carId);
    const ev = createEvent(ownerId, carId, CreateEventSchema.parse(body));
    return ok(201, await deps.events.create(ev));
  }
  if (eventId && path === `${base}/${eventId}` && method === 'GET') {
    await requireCar(deps, ownerId, carId);
    const ev = await deps.events.getById(ownerId, carId, eventId);
    if (!ev) throw new EventNotFoundError(eventId);
    return ok(200, ev);
  }
  if (eventId && path === `${base}/${eventId}` && method === 'PUT') {
    await requireCar(deps, ownerId, carId);
    await requireEvent(deps, ownerId, carId, eventId);
    return ok(200, await deps.events.update(ownerId, carId, eventId, CreateEventSchema.parse(body)));
  }
  if (eventId && path === `${base}/${eventId}` && method === 'DELETE') {
    await requireCar(deps, ownerId, carId);
    // Cascade: delete proof objects + rows, then the event.
    const proofs = await deps.proofs.listByEvent(ownerId, carId, eventId);
    for (const p of proofs) {
      await deps.storage.deleteObject(proofKey(ownerId, carId, eventId, p.id));
      await deps.proofs.delete(ownerId, carId, eventId, p.id);
    }
    await deps.events.delete(ownerId, carId, eventId);
    return ok(204, null);
  }
  return null;
}
```

- [ ] **Step 2: Add `ProofNotFoundError`/`EventNotFoundError` → 404 mapping in `apps/api/src/errors.ts`**

In `withErrorHandling`'s catch chain, alongside the existing `CarNotFoundError`/`PhotoNotFoundError` branches add:

```ts
    if (err instanceof EventNotFoundError || err instanceof ProofNotFoundError) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'NotFound', message: err.message }) };
    }
```

and extend the domain import at the top of `errors.ts` to include `EventNotFoundError, ProofNotFoundError`.

- [ ] **Step 3: Extend `RouteDeps` + dispatch in `apps/api/src/router.ts`**

Update the import and `RouteDeps`, and add the events dispatch BEFORE the car exact-path branches:

```ts
import { CarNotFoundError, createCar, type CarRepository, type PhotoRepository, type PhotoStorage, type EventRepository, type ProofRepository } from '@carlog/domain';
import { handlePhotoRoute } from './photo-routes';
import { handleEventRoute } from './event-routes';

export type RouteDeps = {
  cars: CarRepository; photos: PhotoRepository; storage: PhotoStorage;
  events: EventRepository; proofs: ProofRepository;
};
```

Inside `route`, after the photo dispatch block and before the `/cars` branches:

```ts
    if (id && path.startsWith(`/cars/${id}/events`)) {
      const result = await handleEventRoute(deps, event, ownerId, id);
      if (result) return result;
    }
```

(`handleEventRoute`'s `EventDeps` is structurally satisfied by `RouteDeps` — pass `deps` directly.)

- [ ] **Step 4: Extend `apps/api/src/router.test.ts` deps + add event/proof tests**

Update the deps setup to include the event + proof fakes and the stub storage's `exists`:

```ts
import { InMemoryEventRepository } from './in-memory-event-repository';
import { InMemoryProofRepository } from './in-memory-proof-repository';
// ...in beforeEach, extend deps:
deps = {
  cars, photos, storage,
  events: new InMemoryEventRepository(),
  proofs: new InMemoryProofRepository(),
};
```

Ensure the stub `storage` object includes `exists: async () => true` (added in the photos feature; keep it). Add these tests:

```ts
describe('event routes', () => {
  const ev = { date: '2026-07-14', mileage: 1000, cost: 500, category: 'oil_change', works: [{ description: 'Oil change', parts: [{ name: 'Filter', quantity: 1 }] }] };

  async function makeCar(ownerId: string) {
    const res = await route(deps, { ...base, method: 'POST', path: '/cars', ownerId, body: validBody });
    return JSON.parse(res.body).id as string;
  }

  it('creates and lists events for the owner car', async () => {
    const carId = await makeCar('u1');
    const created = await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev });
    expect(created.statusCode).toBe(201);
    const list = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId } });
    expect(list.statusCode).toBe(200);
    const arr = JSON.parse(list.body);
    expect(arr).toHaveLength(1);
    expect(arr[0].works[0].parts[0].name).toBe('Filter');
  });

  it('event list excludes proof rows (collision guard)', async () => {
    const carId = await makeCar('u1');
    const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev })).body);
    // confirm a proof for the event
    await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events/${created.id}/proofs`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id }, body: { proofId: '99999999-9999-9999-9999-999999999999', contentType: 'application/pdf', size: 1024 } });
    const list = JSON.parse((await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId } })).body);
    expect(list).toHaveLength(1); // only the event, not the proof
    expect(list[0].works).toBeDefined();
  });

  it('404s an event on a car the caller does not own', async () => {
    const carId = await makeCar('u1');
    const res = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events`, ownerId: 'u2', pathParams: { id: carId } });
    expect(res.statusCode).toBe(404);
  });

  it('deleting an event cascade-deletes its proofs', async () => {
    const carId = await makeCar('u1');
    const created = JSON.parse((await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events`, ownerId: 'u1', pathParams: { id: carId }, body: ev })).body);
    await route(deps, { ...base, method: 'POST', path: `/cars/${carId}/events/${created.id}/proofs`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id }, body: { proofId: '88888888-8888-8888-8888-888888888888', contentType: 'application/pdf', size: 1024 } });
    const del = await route(deps, { ...base, method: 'DELETE', path: `/cars/${carId}/events/${created.id}`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id } });
    expect(del.statusCode).toBe(204);
    const proofs = await route(deps, { ...base, method: 'GET', path: `/cars/${carId}/events/${created.id}/proofs`, ownerId: 'u1', pathParams: { id: carId, eventId: created.id } });
    // event is gone -> requireEvent throws 404
    expect(proofs.statusCode).toBe(404);
  });
});
```

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `pnpm --filter @carlog/api test && pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/api lint`
Expected: all PASS (existing 14 + new event tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/event-routes.ts apps/api/src/router.ts apps/api/src/router.test.ts apps/api/src/errors.ts
git commit -m "feat(api): add event + proof routes with cascade delete and collision guard"
```

---

### Task 5: Dynamo event + proof repositories; handler wiring

**Files:** Create `apps/api/src/dynamo-event-repository.ts`, `apps/api/src/dynamo-proof-repository.ts`; Modify `apps/api/src/handler.ts`.

**Interfaces:**
- Consumes: `Event`/`CreateEventInput`/`Proof` from contracts; `EventNotFoundError`, `EventRepository`, `ProofRepository` from domain; `eventSk`, `proofSk`, `isEventRow` from `./event-key`; existing `DynamoDBDocumentClient`, `S3PhotoStorage`.
- Produces: `DynamoEventRepository`, `DynamoProofRepository`; handler builds them into `deps`.

- [ ] **Step 1: Create `apps/api/src/dynamo-event-repository.ts`**

```ts
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { Event, CreateEventInput } from '@carlog/contracts';
import { EventNotFoundError, type EventRepository } from '@carlog/domain';
import { eventSk, isEventRow } from './event-key';

const pk = (ownerId: string) => `USER#${ownerId}`;
type Row = Event & { PK: string; SK: string };
const toRow = (e: Event): Row => ({ ...e, PK: pk(e.ownerId), SK: eventSk(e.carId, e.id) });
const toEvent = (row: Record<string, unknown>): Event => {
  const { PK, SK, ...event } = row as Row;
  return event;
};

export class DynamoEventRepository implements EventRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(event: Event): Promise<Event> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(event) }));
    return event;
  }
  async listByCar(ownerId: string, carId: string): Promise<Event[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': `CAR#${carId}#EVENT#` },
    }));
    // begins_with also matches proof rows (…#PROOF#…) — exclude in code (SK is a key attr; can't FilterExpression it).
    return (res.Items ?? []).filter((i) => isEventRow(String((i as Row).SK))).map(toEvent);
  }
  async getById(ownerId: string, carId: string, eventId: string): Promise<Event | null> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: eventSk(carId, eventId) } }));
    return res.Item ? toEvent(res.Item) : null;
  }
  async update(ownerId: string, carId: string, eventId: string, input: CreateEventInput): Promise<Event> {
    const existing = await this.getById(ownerId, carId, eventId);
    if (!existing) throw new EventNotFoundError(eventId);
    const updated: Event = { ...input, id: existing.id, carId, ownerId, createdAt: existing.createdAt, updatedAt: new Date().toISOString(), currency: input.currency ?? 'UAH', works: input.works ?? [] };
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(updated) }));
    return updated;
  }
  async delete(ownerId: string, carId: string, eventId: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: eventSk(carId, eventId) } }));
  }
}
```

- [ ] **Step 2: Create `apps/api/src/dynamo-proof-repository.ts`**

```ts
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { Proof } from '@carlog/contracts';
import { type ProofRepository } from '@carlog/domain';
import { proofSk } from './event-key';

const pk = (ownerId: string) => `USER#${ownerId}`;
type Row = Proof & { PK: string; SK: string };
const toRow = (p: Proof): Row => ({ ...p, PK: pk(p.ownerId), SK: proofSk(p.carId, p.eventId, p.id) });
const toProof = (row: Record<string, unknown>): Proof => {
  const { PK, SK, ...proof } = row as Row;
  return proof;
};

export class DynamoProofRepository implements ProofRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(proof: Proof): Promise<Proof> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(proof) }));
    return proof;
  }
  async listByEvent(ownerId: string, carId: string, eventId: string): Promise<Proof[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': `CAR#${carId}#EVENT#${eventId}#PROOF#` },
    }));
    return (res.Items ?? []).map(toProof);
  }
  async getById(ownerId: string, carId: string, eventId: string, proofId: string): Promise<Proof | null> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: proofSk(carId, eventId, proofId) } }));
    return res.Item ? toProof(res.Item) : null;
  }
  async delete(ownerId: string, carId: string, eventId: string, proofId: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: proofSk(carId, eventId, proofId) } }));
  }
}
```

- [ ] **Step 3: Wire into `apps/api/src/handler.ts`**

Add imports and extend the `deps` object (the DynamoDBDocumentClient + S3PhotoStorage already exist):

```ts
import { DynamoEventRepository } from './dynamo-event-repository';
import { DynamoProofRepository } from './dynamo-proof-repository';
// ... in the deps object:
const deps: RouteDeps = {
  cars: new DynamoCarRepository(tableName, client),
  photos: new DynamoPhotoRepository(tableName, client),
  storage: new S3PhotoStorage(photosBucket, new S3Client({})),
  events: new DynamoEventRepository(tableName, client),
  proofs: new DynamoProofRepository(tableName, client),
};
```

- [ ] **Step 4: Typecheck + lint + test**

Run: `pnpm --filter @carlog/api typecheck && pnpm --filter @carlog/api lint && pnpm --filter @carlog/api test`
Expected: all PASS (router tests unaffected — use fakes; Dynamo repos verified live).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/dynamo-event-repository.ts apps/api/src/dynamo-proof-repository.ts apps/api/src/handler.ts
git commit -m "feat(api): add DynamoDB event + proof repositories and handler wiring"
```

---

### Task 6: CDK — register event + proof routes

**Files:** Modify `infrastructure/cdk/lib/carlog-stack.ts`.

**Interfaces:** Consumes existing `httpApi`, `integration`, `authorizer`, `HttpMethod`.

- [ ] **Step 1: Add the routes after the existing photo routes**

After the three `httpApi.addRoutes(... /cars/{id}/photos ...)` calls, add:

```ts
    httpApi.addRoutes({ path: '/cars/{id}/events', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}', methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs/presign', methods: [HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}/events/{eventId}/proofs/{proofId}', methods: [HttpMethod.DELETE], integration, authorizer });
```

No new bucket/env/grant — proofs reuse `photosBucket` (already granted) and the same Lambda.

- [ ] **Step 2: Synth to verify**

Run: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk typecheck && AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth > /tmp/sh-synth.txt`
Then: `grep -c 'events' /tmp/sh-synth.txt`
Expected: typecheck passes; synth succeeds; grep count > 0 (event routes present).

- [ ] **Step 3: Commit**

```bash
git add infrastructure/cdk/lib/carlog-stack.ts
git commit -m "feat(cdk): register service-event and proof API routes"
```

---

### Task 7: Web data layer — API client, hooks, attachment validation

**Files:** Modify `apps/web/src/api-client.ts`, `apps/web/src/queries.ts`; Create `apps/web/src/lib/validate-attachment.ts`, `validate-attachment.test.ts`.

**Interfaces:**
- Consumes: `EventSchema`, `CreateEventInput`, `Event`, `ProofWithUrlSchema`, `ProofSchema`, `ProofPresignResponseSchema`, `AttachmentContentType`, `ATTACHMENT_CONTENT_TYPES`, `MAX_PROOF_SIZE`, `MAX_PROOFS_PER_EVENT` from contracts; existing `request`/`uploadToS3`.
- Produces:
  - client: `getEvents`, `createEvent`, `updateEvent`, `deleteEvent`, `presignProof`, `confirmProof`, `listProofs`, `deleteProof`, `uploadProof(token, carId, eventId, file)`.
  - hooks: `useEvents(carId)`, `useCreateEvent(carId)`, `useUpdateEvent(carId)`, `useDeleteEvent(carId)`, `useProofs(carId, eventId)`, `useUploadProof(carId, eventId)`, `useDeleteProof(carId, eventId)`.
  - `validateAttachmentFile(file: { type: string; size: number }, currentCount: number): { key: string; params?: Record<string, unknown> } | null`.

- [ ] **Step 1: Write the failing test — `apps/web/src/lib/validate-attachment.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { validateAttachmentFile } from './validate-attachment';
import { MAX_PROOF_SIZE, MAX_PROOFS_PER_EVENT } from '@carlog/contracts';

describe('validateAttachmentFile', () => {
  it('accepts a jpeg', () => { expect(validateAttachmentFile({ type: 'image/jpeg', size: 1024 }, 0)).toBeNull(); });
  it('accepts a pdf', () => { expect(validateAttachmentFile({ type: 'application/pdf', size: 1024 }, 0)).toBeNull(); });
  it('rejects an unsupported type', () => { expect(validateAttachmentFile({ type: 'text/plain', size: 10 }, 0)?.key).toBe('event:proofBadType'); });
  it('rejects oversize', () => { expect(validateAttachmentFile({ type: 'application/pdf', size: MAX_PROOF_SIZE + 1 }, 0)?.key).toBe('event:proofTooLarge'); });
  it('rejects at cap', () => { expect(validateAttachmentFile({ type: 'application/pdf', size: 10 }, MAX_PROOFS_PER_EVENT)?.key).toBe('event:proofTooMany'); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/web test`
Expected: FAIL — cannot resolve `./validate-attachment`.

- [ ] **Step 3: Create `apps/web/src/lib/validate-attachment.ts`**

```ts
import { ATTACHMENT_CONTENT_TYPES, MAX_PROOF_SIZE, MAX_PROOFS_PER_EVENT } from '@carlog/contracts';

const isAllowed = (t: string): boolean => (ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(t);

export function validateAttachmentFile(
  file: { type: string; size: number }, currentCount: number,
): { key: string; params?: Record<string, unknown> } | null {
  if (currentCount >= MAX_PROOFS_PER_EVENT) return { key: 'event:proofTooMany', params: { max: MAX_PROOFS_PER_EVENT } };
  if (!isAllowed(file.type)) return { key: 'event:proofBadType' };
  if (file.size > MAX_PROOF_SIZE) return { key: 'event:proofTooLarge' };
  if (file.size < 1) return { key: 'event:proofEmpty' };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @carlog/web test`
Expected: PASS.

- [ ] **Step 5: Add event + proof functions to `apps/web/src/api-client.ts`**

Extend the `@carlog/contracts` import with `EventSchema, type Event, type CreateEventInput, ProofWithUrlSchema, ProofSchema, ProofPresignResponseSchema, type ProofWithUrl, type ProofPresignResponse, type AttachmentContentType`. Then append:

```ts
const EventListSchema = z.array(EventSchema);
const ProofListSchema = z.array(ProofWithUrlSchema);

export const getEvents = (token: string, carId: string): Promise<Event[]> =>
  request(token, `/cars/${carId}/events`, EventListSchema);
export const createEvent = (token: string, carId: string, input: CreateEventInput): Promise<Event> =>
  request(token, `/cars/${carId}/events`, EventSchema, { method: 'POST', body: JSON.stringify(input) });
export const updateEvent = (token: string, carId: string, eventId: string, input: CreateEventInput): Promise<Event> =>
  request(token, `/cars/${carId}/events/${eventId}`, EventSchema, { method: 'PUT', body: JSON.stringify(input) });
export const deleteEvent = (token: string, carId: string, eventId: string): Promise<void> =>
  request(token, `/cars/${carId}/events/${eventId}`, EventSchema, { method: 'DELETE' }).then(() => undefined);

const proofBase = (carId: string, eventId: string) => `/cars/${carId}/events/${eventId}/proofs`;
export const presignProof = (token: string, carId: string, eventId: string, input: { contentType: AttachmentContentType; size: number; filename?: string }): Promise<ProofPresignResponse> =>
  request(token, `${proofBase(carId, eventId)}/presign`, ProofPresignResponseSchema, { method: 'POST', body: JSON.stringify(input) });
export const confirmProof = (token: string, carId: string, eventId: string, input: { proofId: string; contentType: AttachmentContentType; size: number; filename?: string }) =>
  request(token, proofBase(carId, eventId), ProofSchema, { method: 'POST', body: JSON.stringify(input) });
export const listProofs = (token: string, carId: string, eventId: string): Promise<ProofWithUrl[]> =>
  request(token, proofBase(carId, eventId), ProofListSchema);
export const deleteProof = (token: string, carId: string, eventId: string, proofId: string): Promise<void> =>
  request(token, `${proofBase(carId, eventId)}/${proofId}`, ProofSchema, { method: 'DELETE' }).then(() => undefined);

export async function uploadProof(token: string, carId: string, eventId: string, file: File): Promise<void> {
  const input = { contentType: file.type as AttachmentContentType, size: file.size, filename: file.name };
  const { uploadUrl, proofId } = await presignProof(token, carId, eventId, input);
  await uploadToS3(uploadUrl, file);
  await confirmProof(token, carId, eventId, { ...input, proofId });
}
```

- [ ] **Step 6: Add hooks to `apps/web/src/queries.ts`**

Extend the `./api-client` import, then append:

```ts
export function useEvents(carId: string) {
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  return useQuery({ queryKey: ['cars', carId, 'events'], queryFn: () => getEvents(token, carId), enabled: Boolean(token && carId) });
}
export function useCreateEvent(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateEventInput) => createEvent(token, carId, input), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'events'] }) });
}
export function useUpdateEvent(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: ({ eventId, input }: { eventId: string; input: CreateEventInput }) => updateEvent(token, carId, eventId, input), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'events'] }) });
}
export function useDeleteEvent(carId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (eventId: string) => deleteEvent(token, carId, eventId), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'events'] }) });
}
export function useProofs(carId: string, eventId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? '';
  return useQuery({ queryKey: ['cars', carId, 'events', eventId, 'proofs'], queryFn: () => listProofs(token, carId, eventId), enabled: Boolean(token && carId && eventId) });
}
export function useUploadProof(carId: string, eventId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (file: File) => uploadProof(token, carId, eventId, file), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'events', eventId, 'proofs'] }) });
}
export function useDeleteProof(carId: string, eventId: string) {
  const { accessToken } = useAuth(); const token = accessToken ?? ''; const qc = useQueryClient();
  return useMutation({ mutationFn: (proofId: string) => deleteProof(token, carId, eventId, proofId), onSuccess: () => qc.invalidateQueries({ queryKey: ['cars', carId, 'events', eventId, 'proofs'] }) });
}
```

Add `CreateEventInput` to the contracts type import in queries.ts.

- [ ] **Step 7: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/api-client.ts apps/web/src/queries.ts apps/web/src/lib/validate-attachment.ts apps/web/src/lib/validate-attachment.test.ts
git commit -m "feat(web): add event + proof API client, hooks, and attachment validation"
```

---

### Task 8: i18n — event namespace (EN + UK)

**Files:** Create `apps/web/src/i18n/locales/en/event.json`, `uk/event.json`; Modify `apps/web/src/i18n/index.ts`.

**Interfaces:** Produces the `event` translation namespace (used by Tasks 9–11).

- [ ] **Step 1: Create `apps/web/src/i18n/locales/en/event.json`**

```json
{
  "sectionTitle": "Service history", "addService": "Add service", "empty": "No service records yet.",
  "loadError": "Could not load service history.",
  "date": "Date", "mileage": "Mileage", "cost": "Cost", "category": "Category", "title": "Title", "notes": "Notes",
  "works": "Works", "addWork": "Add work", "workDescription": "Work description",
  "parts": "Parts", "addPart": "Add part", "partName": "Part name", "brand": "Brand", "partNumber": "Part number",
  "quantity": "Qty", "partNotes": "Notes", "purchaseLink": "Purchase link",
  "save": "Save", "saveChanges": "Save changes", "addTitle": "Add service record", "editTitle": "Edit service record",
  "deleteTitle": "Delete service record", "deleteConfirm": "Delete this service record? This can't be undone.",
  "worksSummary": "{{works}} works · {{parts}} parts",
  "proofs": "Proofs", "addProof": "Add proof", "noProofs": "No proofs.", "openPdf": "Open PDF",
  "proofDeleteTitle": "Delete proof", "proofDeleteConfirm": "Delete this proof? This can't be undone.",
  "proofBadType": "Please choose an image or a PDF.", "proofTooLarge": "That file is larger than 10 MB.",
  "proofTooMany": "You can add at most {{max}} proofs per record.", "proofEmpty": "That file is empty.",
  "proofUploadFailed": "Upload failed. Please try again.", "saveFailed": "Could not save. Please try again.",
  "category_oil_change": "Oil change", "category_tires": "Tires", "category_brakes": "Brakes",
  "category_inspection": "Inspection", "category_repair": "Repair", "category_other": "Other"
}
```

- [ ] **Step 2: Create `apps/web/src/i18n/locales/uk/event.json`**

```json
{
  "sectionTitle": "Історія обслуговування", "addService": "Додати запис", "empty": "Ще немає записів обслуговування.",
  "loadError": "Не вдалося завантажити історію обслуговування.",
  "date": "Дата", "mileage": "Пробіг", "cost": "Вартість", "category": "Категорія", "title": "Назва", "notes": "Нотатки",
  "works": "Роботи", "addWork": "Додати роботу", "workDescription": "Опис роботи",
  "parts": "Запчастини", "addPart": "Додати запчастину", "partName": "Назва запчастини", "brand": "Бренд", "partNumber": "Артикул",
  "quantity": "К-сть", "partNotes": "Нотатки", "purchaseLink": "Посилання на купівлю",
  "save": "Зберегти", "saveChanges": "Зберегти зміни", "addTitle": "Новий запис обслуговування", "editTitle": "Редагувати запис",
  "deleteTitle": "Видалити запис", "deleteConfirm": "Видалити цей запис? Цю дію не можна скасувати.",
  "worksSummary": "{{works}} робіт · {{parts}} запчастин",
  "proofs": "Підтвердження", "addProof": "Додати підтвердження", "noProofs": "Немає підтверджень.", "openPdf": "Відкрити PDF",
  "proofDeleteTitle": "Видалити підтвердження", "proofDeleteConfirm": "Видалити це підтвердження? Цю дію не можна скасувати.",
  "proofBadType": "Оберіть зображення або PDF.", "proofTooLarge": "Файл більший за 10 МБ.",
  "proofTooMany": "Можна додати щонайбільше {{max}} підтверджень на запис.", "proofEmpty": "Файл порожній.",
  "proofUploadFailed": "Не вдалося завантажити. Спробуйте ще раз.", "saveFailed": "Не вдалося зберегти. Спробуйте ще раз.",
  "category_oil_change": "Заміна оливи", "category_tires": "Шини", "category_brakes": "Гальма",
  "category_inspection": "Огляд", "category_repair": "Ремонт", "category_other": "Інше"
}
```

- [ ] **Step 3: Register the namespace in `apps/web/src/i18n/index.ts`**

Add the imports (`import enEvent from './locales/en/event.json';` and the uk equivalent), add `'event'` to the `ns: [...]` array, and add `event: enEvent` / `event: ukEvent` to the `en`/`uk` resources objects.

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/locales/en/event.json apps/web/src/i18n/locales/uk/event.json apps/web/src/i18n/index.ts
git commit -m "feat(web): add event i18n namespace (en/uk) with translated categories"
```

---

### Task 9: EventFormDialog (nested works/parts)

**Files:** Create `apps/web/src/components/EventFormDialog.tsx`.

**Interfaces:**
- Consumes: `CreateEventSchema`, `EVENT_CATEGORIES`, `type Event`, `type CreateEventInput` from contracts; `useCreateEvent`/`useUpdateEvent` from queries; `useForm`/`useFieldArray`/`Controller` from react-hook-form; `zodResolver`.
- Produces: `EventFormDialog({ open, onClose, carId, mode, event }: { open: boolean; onClose: () => void; carId: string; mode: 'create' | 'edit'; event?: Event })`.

- [ ] **Step 1: Create `apps/web/src/components/EventFormDialog.tsx`**

```tsx
import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton,
  MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { CreateEventSchema, EVENT_CATEGORIES, type Event, type CreateEventInput } from '@carlog/contracts';
import { useCreateEvent, useUpdateEvent } from '../queries';

const EMPTY: CreateEventInput = {
  date: new Date().toISOString().slice(0, 10), mileage: 0, cost: 0, currency: 'UAH', category: 'other', works: [],
};

const toForm = (e: Event): CreateEventInput => ({
  date: e.date, mileage: e.mileage, cost: e.cost, currency: e.currency, category: e.category,
  title: e.title, notes: e.notes, works: e.works,
});

export function EventFormDialog({
  open, onClose, carId, mode, event,
}: { open: boolean; onClose: () => void; carId: string; mode: 'create' | 'edit'; event?: Event }) {
  const { t } = useTranslation(['event', 'common']);
  const create = useCreateEvent(carId);
  const update = useUpdateEvent(carId);
  const isPending = create.isPending || update.isPending;

  const { control, handleSubmit, reset, formState: { errors } } = useForm<CreateEventInput>({
    resolver: zodResolver(CreateEventSchema), defaultValues: EMPTY,
  });
  const works = useFieldArray({ control, name: 'works' });

  useEffect(() => {
    if (!open) return;
    reset(mode === 'edit' && event ? toForm(event) : EMPTY);
  }, [open, mode, event, reset]);

  const onSubmit = handleSubmit(async (data) => {
    if (mode === 'edit' && event) await update.mutateAsync({ eventId: event.id, input: data });
    else await create.mutateAsync(data);
    reset(EMPTY); onClose();
  });

  const isError = create.isError || update.isError;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={onSubmit}>
        <DialogTitle>{mode === 'edit' ? t('event:editTitle') : t('event:addTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {isError ? <Alert severity="error">{t('event:saveFailed')}</Alert> : null}
            <Controller name="date" control={control} render={({ field }) => (
              <TextField {...field} type="date" label={t('event:date')} fullWidth InputLabelProps={{ shrink: true }}
                error={Boolean(errors.date)} helperText={errors.date?.message as string | undefined} />
            )} />
            <Controller name="category" control={control} render={({ field }) => (
              <TextField {...field} select label={t('event:category')} fullWidth>
                {EVENT_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{t(`event:category_${c}`)}</MenuItem>)}
              </TextField>
            )} />
            <Controller name="mileage" control={control} render={({ field }) => (
              <TextField {...field} type="number" label={t('event:mileage')} fullWidth value={field.value ?? 0}
                onChange={(e) => field.onChange(Number(e.target.value))}
                error={Boolean(errors.mileage)} helperText={errors.mileage?.message as string | undefined} />
            )} />
            <Controller name="cost" control={control} render={({ field }) => (
              <TextField {...field} type="number" label={t('event:cost')} fullWidth value={field.value ?? 0}
                onChange={(e) => field.onChange(Number(e.target.value))} />
            )} />
            <Controller name="title" control={control} render={({ field }) => (
              <TextField {...field} label={t('event:title')} fullWidth value={field.value ?? ''} />
            )} />
            <Controller name="notes" control={control} render={({ field }) => (
              <TextField {...field} label={t('event:notes')} fullWidth multiline minRows={2} value={field.value ?? ''} />
            )} />

            <Divider textAlign="left"><Typography variant="subtitle2">{t('event:works')}</Typography></Divider>
            {works.fields.map((w, wi) => (
              <Stack key={w.id} spacing={1} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Controller name={`works.${wi}.description`} control={control} render={({ field }) => (
                    <TextField {...field} label={t('event:workDescription')} fullWidth size="small" />
                  )} />
                  <IconButton aria-label="remove work" onClick={() => works.remove(wi)}><DeleteIcon /></IconButton>
                </Stack>
                <PartsEditor control={control} workIndex={wi} />
              </Stack>
            ))}
            <Button onClick={() => works.append({ description: '', parts: [] })}>{t('event:addWork')}</Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button type="submit" variant="contained" disabled={isPending}>
            {mode === 'edit' ? t('event:saveChanges') : t('event:save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function PartsEditor({ control, workIndex }: { control: import('react-hook-form').Control<CreateEventInput>; workIndex: number }) {
  const { t } = useTranslation(['event']);
  const parts = useFieldArray({ control, name: `works.${workIndex}.parts` });
  const text = (pi: number, field: 'name' | 'brand' | 'partNumber' | 'notes' | 'purchaseLink', label: string) => (
    <Controller name={`works.${workIndex}.parts.${pi}.${field}`} control={control} render={({ field: f }) => (
      <TextField {...f} label={label} size="small" fullWidth value={f.value ?? ''} />
    )} />
  );
  return (
    <Stack spacing={1.5} sx={{ pl: 1 }}>
      {parts.fields.map((p, pi) => (
        <Stack key={p.id} spacing={1} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            {text(pi, 'name', t('event:partName'))}
            <Controller name={`works.${workIndex}.parts.${pi}.quantity`} control={control} render={({ field }) => (
              <TextField {...field} type="number" label={t('event:quantity')} size="small" sx={{ width: 90 }}
                value={field.value ?? 1} onChange={(e) => field.onChange(Number(e.target.value))} />
            )} />
            <IconButton aria-label="remove part" size="small" onClick={() => parts.remove(pi)}><DeleteIcon fontSize="small" /></IconButton>
          </Stack>
          <Stack direction="row" spacing={1}>
            {text(pi, 'brand', t('event:brand'))}
            {text(pi, 'partNumber', t('event:partNumber'))}
          </Stack>
          {text(pi, 'purchaseLink', t('event:purchaseLink'))}
          {text(pi, 'notes', t('event:partNotes'))}
        </Stack>
      ))}
      <Button size="small" onClick={() => parts.append({ name: '', quantity: 1 })}>{t('event:addPart')}</Button>
    </Stack>
  );
}
```

Note: the parts editor exposes ALL Part fields (name, quantity, brand, part number, purchase link, notes) — the full model the schema supports. Optional fields submit as empty strings; `PartUsageSchema`'s `optText` (Task 1) normalizes `''` → `undefined` before validation, so an empty `purchaseLink` doesn't trip the `.url()` check.

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/EventFormDialog.tsx
git commit -m "feat(web): add EventFormDialog with nested works/parts (useFieldArray)"
```

---

### Task 10: EventCard + ProofList

**Files:** Create `apps/web/src/components/EventCard.tsx`, `apps/web/src/components/ProofList.tsx`.

**Interfaces:**
- Consumes: `type Event` from contracts; `useDeleteEvent` from queries; `formatNumber`/`formatDate` from `../i18n/format`; `EventFormDialog` (T9); `ConfirmDialog`; `useProofs`/`useUploadProof`/`useDeleteProof` (T7); `validateAttachmentFile` (T7).
- Produces: `EventCard({ carId, event })`, `ProofList({ carId, eventId })`.

- [ ] **Step 1: Create `apps/web/src/components/ProofList.tsx`**

```tsx
import { useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, IconButton, Link, Stack, Typography } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useTranslation } from 'react-i18next';
import { useProofs, useUploadProof, useDeleteProof } from '../queries';
import { validateAttachmentFile } from '../lib/validate-attachment';
import { ConfirmDialog } from './ConfirmDialog';

export function ProofList({ carId, eventId }: { carId: string; eventId: string }) {
  const { t } = useTranslation(['event', 'common']);
  const { data: proofs } = useProofs(carId, eventId);
  const upload = useUploadProof(carId, eventId);
  const del = useDeleteProof(carId, eventId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const v = validateAttachmentFile({ type: file.type, size: file.size }, proofs?.length ?? 0);
    if (v) { setError(t(v.key, v.params)); return; }
    setError(null);
    try { await upload.mutateAsync(file); } catch { setError(t('event:proofUploadFailed')); }
  };

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle2">{t('event:proofs')}</Typography>
        <Button size="small" startIcon={<AttachFileIcon />} onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {t('event:addProof')}
        </Button>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" hidden onChange={onPick} />
      </Stack>
      {error ? <Alert severity="error" sx={{ my: 1 }}>{error}</Alert> : null}
      {!proofs?.length ? (
        <Typography variant="body2" color="text.secondary">{t('event:noProofs')}</Typography>
      ) : (
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
          {proofs.map((p) => (
            <Box key={p.id} sx={{ position: 'relative' }}>
              {p.contentType === 'application/pdf' ? (
                <Link href={p.url} target="_blank" rel="noopener" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 1, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                  <PictureAsPdfIcon color="error" /> <Typography variant="body2" noWrap sx={{ maxWidth: 140 }}>{p.filename ?? t('event:openPdf')}</Typography>
                </Link>
              ) : (
                <img src={p.url} alt="proof" loading="lazy" onClick={() => setLightbox(p.url)}
                  style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, cursor: 'pointer' }} />
              )}
              <IconButton size="small" aria-label="delete proof" onClick={() => setToDelete(p.id)}
                sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'background.paper', boxShadow: 1 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Stack>
      )}
      <Dialog open={Boolean(lightbox)} onClose={() => setLightbox(null)} maxWidth="md">
        {lightbox ? <img src={lightbox} alt="proof" style={{ width: '100%', display: 'block' }} /> : null}
      </Dialog>
      <ConfirmDialog open={Boolean(toDelete)} title={t('event:proofDeleteTitle')} message={t('event:proofDeleteConfirm')}
        confirmLabel={t('common:delete')} loading={del.isPending}
        onConfirm={async () => { if (toDelete) await del.mutateAsync(toDelete); setToDelete(null); }}
        onClose={() => setToDelete(null)} />
    </Box>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/components/EventCard.tsx`**

```tsx
import { useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Button, Chip, Stack, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';
import type { Event } from '@carlog/contracts';
import { formatNumber, formatDate } from '../i18n/format';
import { useDeleteEvent } from '../queries';
import { EventFormDialog } from './EventFormDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ProofList } from './ProofList';

export function EventCard({ carId, event }: { carId: string; event: Event }) {
  const { t, i18n } = useTranslation(['event', 'common']);
  const del = useDeleteEvent(carId);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const partsCount = event.works.reduce((n, w) => n + w.parts.length, 0);

  return (
    <Accordion disableGutters sx={{ borderRadius: 2, '&:before': { display: 'none' }, border: 1, borderColor: 'divider', mb: 1 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', width: '100%' }}>
          <Chip label={t(`event:category_${event.category}`)} size="small" color="primary" variant="outlined" />
          <Typography sx={{ fontWeight: 600 }}>{formatDate(`${event.date}T00:00:00.000Z`, i18n.language)}</Typography>
          <Typography color="text.secondary">
            {formatNumber(event.mileage, i18n.language)} · {formatNumber(event.cost, i18n.language)} {event.currency}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        {event.title ? <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{event.title}</Typography> : null}
        {event.notes ? <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{event.notes}</Typography> : null}
        <Typography variant="subtitle2">{t('event:worksSummary', { works: event.works.length, parts: partsCount })}</Typography>
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {event.works.map((w, i) => (
            <Typography key={i} variant="body2">
              • {w.description}{w.parts.length ? ` — ${w.parts.map((p) => `${p.name}×${p.quantity}`).join(', ')}` : ''}
            </Typography>
          ))}
        </Stack>
        <ProofList carId={carId} eventId={event.id} />
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button size="small" variant="contained" onClick={() => setEditOpen(true)}>{t('common:edit')}</Button>
          <Button size="small" color="error" onClick={() => setConfirmOpen(true)}>{t('common:delete')}</Button>
        </Stack>
      </AccordionDetails>
      <EventFormDialog open={editOpen} onClose={() => setEditOpen(false)} carId={carId} mode="edit" event={event} />
      <ConfirmDialog open={confirmOpen} title={t('event:deleteTitle')} message={t('event:deleteConfirm')}
        confirmLabel={t('common:delete')} loading={del.isPending}
        onConfirm={async () => { await del.mutateAsync(event.id); setConfirmOpen(false); }}
        onClose={() => setConfirmOpen(false)} />
    </Accordion>
  );
}
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/EventCard.tsx apps/web/src/components/ProofList.tsx
git commit -m "feat(web): add EventCard (expandable) and ProofList (image/pdf) components"
```

---

### Task 11: ServiceTimeline + mount on Vehicle page

**Files:** Create `apps/web/src/components/ServiceTimeline.tsx`; Modify `apps/web/src/routes/Vehicle.tsx`.

**Interfaces:**
- Consumes: `useEvents` (T7); `EventCard` (T10); `EventFormDialog` (T9); `StatusView`.
- Produces: `ServiceTimeline({ carId })`.

- [ ] **Step 1: Create `apps/web/src/components/ServiceTimeline.tsx`**

```tsx
import { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';
import { useEvents } from '../queries';
import { EventCard } from './EventCard';
import { EventFormDialog } from './EventFormDialog';
import { StatusView } from './ui/StatusView';

export function ServiceTimeline({ carId }: { carId: string }) {
  const { t } = useTranslation(['event']);
  const { data: events, isLoading, isError } = useEvents(carId);
  const [open, setOpen] = useState(false);

  const sorted = [...(events ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <Box sx={{ mt: 4 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">{t('event:sectionTitle')}</Typography>
        <Button startIcon={<AddIcon />} onClick={() => setOpen(true)}>{t('event:addService')}</Button>
      </Stack>
      {isLoading ? (
        <StatusView state="loading" />
      ) : isError ? (
        <StatusView state="error" message={t('event:loadError')} />
      ) : !sorted.length ? (
        <Typography color="text.secondary">{t('event:empty')}</Typography>
      ) : (
        <Box>{sorted.map((e) => <EventCard key={e.id} carId={carId} event={e} />)}</Box>
      )}
      <EventFormDialog open={open} onClose={() => setOpen(false)} carId={carId} mode="create" />
    </Box>
  );
}
```

- [ ] **Step 2: Mount on the Vehicle page**

In `apps/web/src/routes/Vehicle.tsx`, import `ServiceTimeline` and render `<ServiceTimeline carId={car.id} />` inside the main `<Container>` AFTER the `<PhotoGallery ... />` (and before the delete-error Alert). Add:

```tsx
import { ServiceTimeline } from '../components/ServiceTimeline';
// ... after <PhotoGallery carId={car.id} />
        <ServiceTimeline carId={car.id} />
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ServiceTimeline.tsx apps/web/src/routes/Vehicle.tsx
git commit -m "feat(web): add ServiceTimeline to the Vehicle page"
```

---

### Task 12: Full verification + deploy (backend + web)

**Files:** none (verification + deploy).

- [ ] **Step 1: Run all repo gates**

Run: `pnpm turbo run typecheck lint test`
Expected: all packages PASS — contracts (event tests added), domain (event tests), api (event/proof route tests), web (validate-attachment).

- [ ] **Step 2: SW guard**

Run: `pnpm --filter @carlog/web build && grep -c 'execute-api' apps/web/dist/sw.js`
Expected: `0`.

- [ ] **Step 3: Deploy backend (new routes + Lambda code)**

Run: `AWS_PROFILE=yevhenii CDK_DEFAULT_REGION=us-east-1 pnpm --filter @carlog/cdk exec cdk deploy --require-approval never`
Expected: deploys; the 5 event/proof routes added; Lambda updated. (Human deploy gate — controller pauses for go.)

- [ ] **Step 4: Deploy web**

Run: `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`
Expected: builds, syncs, invalidates; prints CloudFront URL.

- [ ] **Step 5: Live smoke test (definition of done)**

On the deployed app, signed in, on a car's Vehicle page:
1. Service history → Add service (date, mileage, cost, category) with 2 works, each 1–2 parts → appears in the reverse-chron timeline, localized.
2. **Regression guard:** `GET /cars` returns only cars; the events list returns only events (no proof rows) — verify via the app AND a direct token call for the car (should be car-only) and `.../events` (event-only).
3. Expand the event → attach a PDF and an image proof → PDF as a download card (opens signed URL), image as thumbnail; reload persists.
4. Edit the event (change a work/part) → full-replace persists.
5. Delete the event → gone; its proofs cascade-deleted (list a nonexistent event's proofs → 404; the S3 objects are removed).
6. Switch EN⇄UK → category chips + all timeline strings translate.

Expected: all pass.

---

## Self-Review Notes

- **Spec coverage:** contracts (Event/Work/Part + Proof) → T1; domain factory/ports → T2; pure helpers + collision-guard fakes → T3; routes + cascade delete + router → T4; Dynamo repos + handler → T5; CDK routes → T6; web client/hooks/validation → T7; i18n event ns → T8; nested form → T9; card+proofs → T10; timeline mount → T11; verify+deploy → T12. All spec layers mapped.
- **SK collision guard (the load-bearing lesson):** `isEventRow` excludes `#PROOF#` rows; `DynamoEventRepository.listByCar` filters in code (not FilterExpression — SK is a key attr, learned from the cars bug); the in-memory `EventRepository` fake stores rows in ONE SK-keyed map so a proof row CAN leak if the filter is wrong, and T4's "event list excludes proof rows" test asserts it doesn't. Directly guards the exact class of bug we just fixed.
- **Proof infra reuse:** reuses `S3PhotoStorage` (unchanged) + presign flow; carries forward all photo final-review fixes (presigned id on confirm via `ProofConfirmSchema.proofId`; no ContentLength; cap on confirm; `storage.exists` HeadObject check). No duplicate storage code. `validate-photo.ts`/PhotoGallery untouched (new `validate-attachment.ts`).
- **Type consistency:** `EventRepository`/`ProofRepository` port signatures (T2) used identically by fakes (T3), routes (T4), Dynamo impls (T5); `RouteDeps` extended once (T4) and satisfied by handler (T5) + tests (T4); `createEvent`, `eventSk`/`proofSk`/`proofKey`/`isEventRow` consistent; contracts consts (`MAX_PROOFS_PER_EVENT`, `ATTACHMENT_CONTENT_TYPES`) used verbatim in api + web. Query keys `['cars',carId,'events']` and `[...,'events',eventId,'proofs']` consistent across hooks.
- **Full-replace PUT:** event update preserves id/carId/ownerId/createdAt (the car-edit lesson) in both the fake and Dynamo impl.
- **No `any`; extensionless imports; MUI-only; i18n for every string (incl. translated category enum); conventional commits; SW guard re-checked in T12.**
- **Full part fields (user decision):** T9's parts editor exposes ALL Part fields (name, quantity, brand, part number, purchase link, notes) — the complete model. `PartUsageSchema`'s `optText` normalizes empty-string optionals to `undefined` (T1) so an empty `purchaseLink` doesn't fail `.url()` — the empty-optional lesson from the blank-VIN car bug, with a dedicated T1 test.
