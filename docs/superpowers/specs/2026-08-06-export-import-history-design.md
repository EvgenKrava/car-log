# Export / Import Car History

**Date:** 2026-08-06
**Status:** Approved

## Goal

User-owned data portability: export one car's complete service book (profile + events +
reminders) as a JSON file from the Vehicle page, and import such a file as a **new car**
from the Garage. Backup, account moves, and restore-after-delete all reduce to these two
operations.

## Decisions taken (confirmed 2026-08-06)

- **Export scope:** full car — profile, complete event timeline (works + parts), reminders.
  Attachments (proof photos/PDFs) excluded in v1.
- **Import mode:** always creates a NEW car. No merging, no dedup, existing cars never touched.

## File format

One JSON file per car. The contract (new `packages/contracts/src/export.ts`) is the source
of truth for BOTH directions:

```ts
export const CAR_EXPORT_FORMAT = 'carlog-car';
export const CAR_EXPORT_VERSION = 1;

export const CarExportSchema = z.object({
  format: z.literal(CAR_EXPORT_FORMAT),
  version: z.literal(CAR_EXPORT_VERSION),   // widen to a union when v2 exists
  exportedAt: z.string().datetime(),
  attachments: z.literal('not-included'),   // explicit marker for future versions
  car: CreateCarSchema,
  events: z.array(CreateEventSchema).max(MAX_JOB_EVENTS),
  reminders: z.array(CreateReminderSchema).max(MAX_REMINDERS_PER_CAR),
});
export type CarExport = z.infer<typeof CarExportSchema>;
```

Shapes are the CREATE contracts — server-owned fields (`id`, `carId`, `ownerId`,
`createdAt`, `updatedAt`, `shared`) are deliberately absent: they are what the import
re-mints. Filename convention: `carlog-<make>-<model>-<YYYY-MM-DD>.json` (lowercased,
non-alphanumerics dashed).

## Export — fully client-side

- Entry: an "Export history" item in the Vehicle page's existing car-actions menu.
- The page's query cache already holds car + events + reminders; a pure
  `toCarExport(car: Car, events: Event[], reminders: Reminder[], exportedAt: string): CarExport`
  in `packages/domain` strips server fields (explicit field mapping, `buildCarChatContext`
  style — never spread-and-delete) and the result is `JSON.stringify`'d and downloaded via
  a Blob + object URL. No backend, no S3.
- `exportedAt` is injected (the domain stays clock-free); events are exported
  **newest-first** (matching the API's list order — order is not semantically meaningful
  on import, which re-creates all of them).
- The export must parse against `CarExportSchema` by construction; the round-trip test
  pins it.

## Import — one new backend route

`POST /import/car`, authed, body = the export file's JSON.

1. Parse with `CarExportSchema` — unknown `format`/`version` or malformed shapes → 400
   `ValidationError` (Zod path in the existing error mapping).
2. Caps are enforced by the schema itself (≤ `MAX_JOB_EVENTS` events, ≤
   `MAX_REMINDERS_PER_CAR` reminders). Payload size: API Gateway's 10MB is ample (a
   500-event car ≈ 300KB); no extra size gate needed beyond the schema.
3. Server-side creation order: car first (`createCar` — `shared: false`, fresh id), then
   every event (`createEvent`), then every reminder (`createReminder`). Repos are called
   directly in the route/service — NOT via per-item HTTP.
4. **Failure cleanup:** if any event/reminder write throws, delete everything created so
   far (events then car — reminders are written last, so at reminder-failure time delete
   reminders written, events, then the car) and rethrow → 500. A half-imported car must
   never remain in the garage. Retry of the whole import is then safe.
5. Car mileage comes from the file's `car.mileage` verbatim — NOT re-derived from events.
6. Response: 201 with the created `Car`.

Rejected alternative: client-side per-event POSTs — 156 events = 156 round-trips through
the 20 req/s stage throttle, and a mid-way network failure leaves a corrupted half-car.

## UI

- **Garage:** an "Import car" affordance next to the existing add flow (menu item or
  secondary button — match the page's existing patterns). Hidden file input accepts
  `.json`/`application/json`.
- Picked file is parsed **client-side with the same `CarExportSchema`** to render a
  preview card: make/model/year, event count, reminder count, export date. Import button
  posts the validated object to `/import/car`; success invalidates the cars query and
  navigates to the new car.
- Error states (specific messages, en + uk, new `export` i18n namespace or extend
  `garage`): not a CarLog export file / unsupported version (file from a newer app) /
  too many events or reminders / generic server failure.
- The import dialog uses the app `Modal` (inherits sheet behavior + slide-up).

## CDK

One `addRoutes` entry: `POST /import/car`, JWT authorizer, existing integration.

## Testing

- **Domain:** `toCarExport` — explicit-field mapping (no `ownerId`/ids anywhere in output,
  asserted by value like the chat-context leak test), round-trip property (output parses
  against `CarExportSchema`; parsed `car`/`events`/`reminders` deep-equal the inputs minus
  server fields), newest-first ordering, `exportedAt` injection.
- **API route:** happy path (201, car + all events + reminders present); 400 on wrong
  format/version/shape; cap overflow rejected by schema; **mid-failure cleanup** (a repo
  fake that throws on the Nth event → assert no car remains); imported car's mileage
  equals the file's.
- **Contracts:** `CarExportSchema` accepts a golden fixture; rejects `version: 2`,
  missing `format`, extra top-level fields passthrough behavior (document what Zod does —
  default strip — and pin it).
- **Web:** gates only (no component harness); manual: export Галя → re-import → identical
  timeline/reminders on the new car.

## Out of scope (v1)

- Attachments/proofs in the export (format reserves the field).
- Merge-into-existing-car; duplicate detection.
- CSV/spreadsheet export; full-garage (multi-car) export.
- Public share page export.
