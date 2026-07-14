# Full Service History — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** the deployed CarLog app (cars CRUD + photos + custom login + i18n).
Implements the `DOMAIN.md` core: Event → Work → PartUsage, the maintenance timeline
that `UI_UX.md` calls the primary screen.

## Goal

A per-car structured service book: the owner records service **Events** (date, mileage,
cost, category), each containing **Works** (maintenance actions) that list **Parts**
(brand, name, part#, qty, notes, purchase link), plus **proof attachments** (PDF or
image). Displayed as a reverse-chronological timeline on the Vehicle page.

## Locked Decisions

| Area | Decision |
|------|----------|
| Model depth | Full 3-level: Event → Works[] → Parts[] |
| Storage | Event-as-document: one DynamoDB item per Event with Works/Parts embedded as JSON; proofs are separate rows |
| Category | Fixed enum: `oil_change, tires, brakes, inspection, repair, other` |
| Proofs | PDF + images, attached at the **Event** level; reuse the pre-signed S3 attachment infra (generalized to accept `application/pdf`) |
| Timeline UX | A "Service history" section on the existing Vehicle detail page (reverse-chron event cards, expand for works/parts/proofs, add/edit dialog) |
| Scope | One feature, sequenced layers (contracts → backend → UI → proofs) |
| Currency | Stored as a number + `currency` field defaulting to `UAH` |
| Update semantics | Full-replace on PUT (preserve id/carId/ownerId/createdAt) — the car-edit lesson |

## Layer 1 — Contracts + data model

New Zod schemas in `packages/contracts/src/event.ts` (nested validation on write):

```
PartUsageSchema = {
  name: string(1..80),
  brand?: string(≤60), partNumber?: string(≤60),
  quantity: int ≥ 1,
  notes?: string(≤500), purchaseLink?: url,
}
WorkSchema = { description: string(1..200), parts: PartUsage[] (default []) }
EventCategorySchema = z.enum(['oil_change','tires','brakes','inspection','repair','other'])
EventSchema = {
  id: uuid, carId: uuid, ownerId: string,
  date: string (YYYY-MM-DD), mileage: int ≥ 0,
  cost: number ≥ 0, currency: string (default 'UAH'),
  category: EventCategory,
  title?: string(≤120), notes?: string(≤2000),
  works: Work[] (default []),
  createdAt: datetime, updatedAt: datetime,
}
CreateEventSchema = EventSchema.omit({ id, carId, ownerId, createdAt, updatedAt })
// PUT is full-replace: reuses CreateEventSchema.
```
Types via `z.infer`: `PartUsage`, `Work`, `EventCategory`, `Event`, `CreateEventInput`.
Constants: `EVENT_CATEGORIES` (the enum tuple), `MAX_WORKS_PER_EVENT = 30`,
`MAX_PARTS_PER_WORK = 30` (bound the embedded document size).

**Storage (single table, event-as-document):**
```
PK = USER#<ownerId>   SK = CAR#<carId>#EVENT#<eventId>          (event, works/parts embedded)
                      SK = CAR#<carId>#EVENT#<eventId>#PROOF#<proofId>   (proof rows, Layer 4)
```
**Collision-proof rule (the SK lesson, first-class):** any `listByCar`/`listByEvent`
query that uses `begins_with` on a prefix that a nested entity also matches MUST filter
out the nested rows in code. `listByCar(events)`: `begins_with(SK, "CAR#<carId>#EVENT#")`
then exclude SKs containing `#PROOF#`. (DynamoDB forbids `FilterExpression` on the SK key
attribute — filter in code, as fixed for cars-vs-photos.)

## Layer 2 — Domain + backend (API)

**`packages/domain`:**
- `createEvent(ownerId, carId, input, deps?)` — validates via `CreateEventSchema` (whole
  nested tree), assigns id/timestamps. Mirrors `createCar`/`createPhoto`.
- `EventRepository` port: `create`, `listByCar(ownerId, carId)`, `getById(ownerId, carId,
  eventId)`, `update(ownerId, carId, eventId, input)`, `delete(ownerId, carId, eventId)`.
  Framework/AWS-free.

**`apps/api`:**
- `DynamoEventRepository` — single-table; `listByCar` applies the `#PROOF#` exclusion
  filter in code; `update` full-replaces preserving id/carId/ownerId/createdAt.
- Routes (flat router, JWT-authorized, `requireCar` first — owner-scoped like cars/photos):
  ```
  GET    /cars/{id}/events
  POST   /cars/{id}/events                 → 201
  GET    /cars/{id}/events/{eventId}
  PUT    /cars/{id}/events/{eventId}       → full-replace → 200
  DELETE /cars/{id}/events/{eventId}       → cascade-delete proofs → 204
  ```
- **Cascade delete:** DELETE event first lists its `#PROOF#` rows, deletes each S3 object +
  row, then deletes the event item — no orphaned proofs/objects.
- Router dispatch: `/cars/{id}/events*` handled BEFORE the car exact-path branches (same
  disambiguation already in place for `/photos`).
- Testable seams: pure `createEvent`; an in-memory `EventRepository` fake storing rows in
  ONE SK-keyed map (so the `#PROOF#` filter is actually exercised — learning from the
  photo fake that hid the last collision bug).

**Security:** ownerId from JWT; `requireCar` verifies ownership; event/proof SKs are
owner+car scoped. No IDOR (same posture as cars/photos, verified).

## Layer 3 — Timeline UI (Vehicle page)

**API client + hooks:** `getEvents`/`createEvent`/`updateEvent`/`deleteEvent`;
`useEvents(carId)` (key `['cars', carId, 'events']`), `useCreateEvent`/`useUpdateEvent`/
`useDeleteEvent` invalidating that key.

**`components/ServiceTimeline.tsx`** (+ `EventCard`, `EventFormDialog`) rendered on the
Vehicle page below the spec card & photos:
- Header "Service history" + **Add service** button.
- Reverse-chronological `EventCard`s: collapsed shows date, translated **category chip**,
  mileage, locale-formatted cost+currency, one-line summary (e.g. "3 works · 5 parts");
  tap to expand → Works (each with Parts: brand/name/part#/qty/notes/purchase-link) + the
  proof list (Layer 4).
- `EventFormDialog` (add/edit): event fields (date, mileage, cost, category select, title,
  notes) + a **dynamic Works editor** (RHF `useFieldArray`, add/remove work rows; each work
  has a nested **Parts editor**, also `useFieldArray`). Validated by
  `zodResolver(CreateEventSchema)` over the whole tree.
- Delete via existing `ConfirmDialog`. States via `StatusView` (loading skeleton, empty
  "No service records yet", error).
- **i18n:** new `event` namespace (EN + UK); category enum translated as
  `event:category_<value>`; consistent with the shipped i18n feature. Locale-aware cost/date.
- Inherits the redesign theme; mobile-first.

## Layer 4 — Proof attachments (generalize the photo infra)

Reuse the pre-signed flow (presign → direct S3 PUT → confirm) proven by the photo feature;
generalize rather than duplicate. **Carry forward every photo final-review fix:** confirm
uses the presigned id (not a fresh one), presignPut does NOT sign `ContentLength`, cap
checked on confirm, S3 existence-check on confirm.

- **Contracts:** `AttachmentContentTypeSchema = [image/jpeg, image/png, image/webp,
  image/heic, application/pdf]`. `ProofSchema = { id, eventId, carId, ownerId, contentType,
  size, filename?, createdAt }`; `MAX_PROOF_SIZE = 10_485_760`, `MAX_PROOFS_PER_EVENT = 20`.
- **Storage:** reuse the existing `S3PhotoStorage` adapter (content-type-agnostic —
  presignPut/presignGet/deleteObject already generic; no rewrite). Proof S3 key:
  `proofs/<ownerId>/<carId>/<eventId>/<proofId>`.
- **`ProofRepository`** (Dynamo): `SK = CAR#<carId>#EVENT#<eventId>#PROOF#<proofId>`;
  `listByEvent` queries that exact prefix (leaf-level, no further nesting → no collision).
- **Routes** (event-scoped, mirroring photos):
  ```
  POST   /cars/{id}/events/{eventId}/proofs/presign
  POST   /cars/{id}/events/{eventId}/proofs
  GET    /cars/{id}/events/{eventId}/proofs
  DELETE /cars/{id}/events/{eventId}/proofs/{proofId}
  ```
- **Frontend:** `ProofList` inside the expanded `EventCard` — "Add proof" (file input
  `accept="image/*,application/pdf"`), client-validate via a generalized
  `validateAttachmentFile` (accepts PDF), presign→PUT→confirm upload, render **images as
  thumbnails** (lightbox) and **PDFs as a download card** (filename → opens signed URL).
  Delete via `ConfirmDialog`.

## Testing

- **Vitest (pure):** Event/Work/Part schema round-trips (valid nested tree; reject bad
  quantity/category/notes-length/purchaseLink-url); `createEvent` validation; the
  **`#PROOF#` exclusion filter** (dedicated test — fake stores rows in one SK-keyed map so
  a proof row can leak if the filter is wrong; assert it doesn't); proof key + cap;
  `validateAttachmentFile` (image + PDF accepted, bad type/size/cap rejected, key-based).
- **Router tests (fakes):** event CRUD, owner-scoping 404, cascade-delete removes proofs,
  proof presign/confirm/list/delete.
- **Static gates:** `pnpm turbo run typecheck lint test` green. **SW guard:**
  `grep -c execute-api dist/sw.js == 0`.

## Verification (definition of done)

Deploy backend + web, then on the deployed app:
1. Car → Service history → add an event (date, mileage, cost, category) with 2 works, each
   with parts → appears in the reverse-chron timeline, localized.
2. **Regression guard:** `GET /cars` returns only cars; `GET .../events` returns only
   events (no `#PROOF#` leakage) — the collision class, re-checked.
3. Attach a proof PDF + a proof image → PDF as download card (opens signed URL), image as
   thumbnail; reload persists.
4. Edit the event (change works/parts) → full-replace persists.
5. Delete the event → gone AND its proof S3 objects/rows cascade-deleted (no orphans).
6. Switch EN⇄UK → category chips + timeline strings translate.

## Scope Guard (YAGNI)

Out of scope: cross-car global timeline, reminders (Phase 2), per-Work proofs, export/CSV,
cost analytics/stats, editing works/parts outside the event form. Just the per-car
structured service book with event-level proofs.

## Files (anticipated)

```
packages/contracts/src/event.ts               CREATE  Event/Work/Part/category schemas + consts
packages/contracts/src/event.test.ts          CREATE
packages/contracts/src/proof.ts                CREATE  Proof schema + attachment content types
packages/contracts/src/index.ts               MODIFY  export event, proof
packages/domain/src/event.ts                   CREATE  createEvent + errors
packages/domain/src/event-repository.ts        CREATE  EventRepository port
packages/domain/src/proof-repository.ts        CREATE  ProofRepository port
packages/domain/src/event.test.ts             CREATE
packages/domain/src/index.ts                   MODIFY
apps/api/src/event-key.ts                      CREATE  eventSk + #PROOF# filter helper + assertUnderCap
apps/api/src/event-key.test.ts                 CREATE
apps/api/src/in-memory-event-repository.ts     CREATE  SK-keyed fake (exercises the filter)
apps/api/src/in-memory-proof-repository.ts     CREATE
apps/api/src/dynamo-event-repository.ts        CREATE
apps/api/src/dynamo-proof-repository.ts        CREATE
apps/api/src/event-routes.ts                   CREATE  event + proof handlers (+ cascade delete)
apps/api/src/router.ts                         MODIFY  dispatch /cars/{id}/events*
apps/api/src/handler.ts                        MODIFY  build event/proof repos, extend deps
apps/api/src/router.test.ts                    MODIFY  event + proof route tests
apps/web/src/api-client.ts                     MODIFY  events + proofs client fns
apps/web/src/queries.ts                        MODIFY  useEvents/useCreateEvent/... + proof hooks
apps/web/src/lib/validate-attachment.ts        CREATE  (new; accepts image+PDF. Leave validate-photo.ts + PhotoGallery's use of it untouched — only PhotoGallery consumes it today)
apps/web/src/components/ServiceTimeline.tsx    CREATE
apps/web/src/components/EventCard.tsx          CREATE
apps/web/src/components/EventFormDialog.tsx    CREATE  nested works/parts (useFieldArray)
apps/web/src/components/ProofList.tsx          CREATE
apps/web/src/routes/Vehicle.tsx                MODIFY  render <ServiceTimeline carId=.../>
apps/web/src/i18n/locales/{en,uk}/event.json   CREATE  event namespace incl. category_*
apps/web/src/i18n/index.ts                     MODIFY  register event namespace
```
