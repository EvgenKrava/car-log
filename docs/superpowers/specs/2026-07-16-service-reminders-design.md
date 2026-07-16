# Service Reminders — Design

Date: 2026-07-16
Status: Approved (in-app only, one-shot + repeat interval, mileage auto-update, vehicle-page section, done-offers-event, Approach A: mutable row + read-time dueness)

## Purpose

Turn CarLog from a passive archive into a proactive tool: per-car reminders for upcoming maintenance, due by date and/or mileage, surfaced in-app. Fills the Phase 2 `Reminder` gap from `carlog-docs/DOMAIN.md` and `ROADMAP.md`.

## Scope

In scope:
- Reminder CRUD per car (date- and/or mileage-based, optional repeat interval).
- Read-time dueness classification (`overdue` / `due_soon` / `ok`) — no server-side scheduling.
- In-app surfacing: vehicle-page section + due badge on garage car cards.
- "Mark done" flow that reschedules repeating reminders and offers to log a matching Event.
- Auto-update of `car.mileage` from event mileage (create/update event, complete reminder).

Out of scope (explicit):
- Email / web-push notifications (no SES, SNS, EventBridge, or scheduled Lambdas).
- Cross-car aggregate `/reminders` screen.
- `MaintenancePlan` entity (later Phase 2 work).
- Auto-completing reminders from created events.
- Completion-occurrence history log.

## Domain model

New `Reminder` entity. Zod contract in `packages/contracts/src/reminder.ts` (source of truth, types via `z.infer`), following `event.ts` conventions including the `optText` empty-string pattern for optional text fields.

```
Reminder {
  id: uuid
  carId: uuid
  ownerId: string
  createdAt, updatedAt: ISO datetime
  title: string (1..120)
  category: EventCategory          // reuse existing enum from event.ts
  notes?: string (max 500)
  dueDate?: string YYYY-MM-DD
  dueMileage?: int >= 0
  repeatMonths?: int 1..120
  repeatKm?: int >= 100
}
```

Constraints (Zod refine on the create/update schema):
- At least one of `dueDate` / `dueMileage` must be set.
- `repeatMonths` requires `dueDate`; `repeatKm` requires `dueMileage` (an interval with no base target is meaningless).

Constants in contracts:
- `MAX_REMINDERS_PER_CAR = 20`
- `REMINDER_LEAD_DAYS = 30`
- `REMINDER_LEAD_KM = 1000`

### Pure domain logic — `packages/domain/src/reminder.ts`

- `reminderStatus(reminder, car, today: string): 'overdue' | 'due_soon' | 'ok'`
  - Overdue when `today >= dueDate` or `car.mileage >= dueMileage`.
  - Due-soon when within `REMINDER_LEAD_DAYS` of `dueDate` or within `REMINDER_LEAD_KM` of `dueMileage`.
  - When both targets are set, the more urgent classification wins (earlier trigger).
  - `today` is passed in (no `Date.now()` inside domain logic) for testability.
- `completeReminder(reminder, completion: {date: string, mileage: number}): Reminder | null`
  - Repeating: returns the next occurrence — `dueDate = completion.date + repeatMonths` (calendar months, clamped for month-end), `dueMileage = completion.mileage + repeatKm`. A target without a repeat interval is dropped from the next occurrence.
  - One-shot (no repeat fields): returns `null` — caller deletes the reminder.
- `bumpCarMileage(car, mileage): Car | null` — returns updated car when `mileage > car.mileage`, else `null` (no write).
- `ReminderRepository` port interface in `packages/domain/src/reminder-repository.ts` (mirrors `event-repository.ts`). Domain stays free of AWS SDK imports.

## API

Routes mirror the events surface; JWT-authorized, owner-scoped:

```
GET    /cars/{id}/reminders                              → Reminder[]
POST   /cars/{id}/reminders                              → 201 Reminder   (409/422 CapExceeded at 20)
PUT    /cars/{id}/reminders/{reminderId}                 → Reminder
DELETE /cars/{id}/reminders/{reminderId}                 → 204
POST   /cars/{id}/reminders/{reminderId}/complete        → 200 next Reminder | 204 (one-shot, deleted)
       body: { date: YYYY-MM-DD, mileage: int >= 0 }
```

Implementation:
- `apps/api/src/reminder-routes.ts`, registered in `router.ts` and in the CDK API Gateway route list.
- `dynamo-reminder-repository.ts` + `in-memory-reminder-repository.ts` (test double), same shape as the event repos.
- Complete flow: load reminder → `completeReminder` → put next occurrence or delete → `bumpCarMileage` with completion mileage → return.
- Event create/update flow: after persisting the event, `bumpCarMileage(car, event.mileage)` and persist the car if changed. No new endpoint; thin-handler rule preserved (logic in domain).

## Persistence

Same single DynamoDB table, same key pattern as `event-key.ts`:

- `PK = USER#{ownerId}` (existing convention), `SK = CAR#{carId}#REMINDER#{reminderId}`
- Key helpers in `apps/api/src/reminder-key.ts` with an `isReminderRow` guard, unit-tested like `event-key.test.ts`.
- List = query by SK prefix `CAR#{carId}#REMINDER#`. Cap check (20) on create, `CapExceededError` reuse.
- Car delete: matches existing behavior — nested rows (events, photos, proofs) are not cascaded today and remain orphaned but unreachable (the car-row whitelist in `listByOwner` and per-car queries hide them). Reminder rows behave the same. A table-wide cleanup cascade is a separate, pre-existing concern, out of scope here.

## Web UI

Feature placement follows existing patterns (components in `apps/web/src/components`, logic in `lib/`, queries in `queries.ts`, api calls in `api-client.ts`).

- **Vehicle page — `RemindersSection`**: section alongside Photos / Service history. Reminder cards sorted overdue → due soon → ok (secondary sort: nearest due). Card shows title, category chip, due target(s) as relative phrasing ("in 12 days", "in 800 km", "5 days overdue"), repeat indicator, and Done / Edit / Delete actions right-aligned (matching event cards). Empty state with an "Add reminder" affordance.
- **`ReminderFormDialog`**: React Hook Form + Zod resolver, bottom sheet on phones (existing dialog behavior). Fields: title, category, due date, due mileage (at least one enforced with a localized message), optional repeat interval inputs (months next to date, km next to mileage), notes. Uses the shared `NumberField`.
- **Done flow**: `ConfirmDialog`-style completion prompt with date (today) and mileage (car's current) prefilled → `POST /complete` → invalidate queries → open `EventFormDialog` pre-filled with reminder title, category, completion date and mileage. The event step is skippable; skipping does not undo the completion.
- **Garage — `VehicleCard` badge**: overdue count (error) or due-soon count (warning) chip. Uses a reminders query per visible car via TanStack Query; acceptable at garage scale (≤ ~10 cars).
- **Status colors**: MUI `error` / `warning` semantic palette in both light and dark themes.
- **i18n**: new `reminders` namespace in `en` and `uk`; all strings, plurals, and relative phrasing localized via the existing `format.ts` helpers.

## Error handling

- Contract violations → 400 with Zod issues (existing handler convention).
- Reminder not found / wrong owner → 404 (existing errors module).
- Cap exceeded → existing `CapExceededError` mapping.
- Complete on an already-deleted reminder → 404; client refetches on error.
- `bumpCarMileage` is best-effort ordering within the request (no transaction): if the car update fails after the event write, the event stands and mileage catches up on the next write — acceptable for a single-user, low-write app.

## Testing

- `packages/domain`: `reminderStatus` boundaries (due today, lead-window edges, both targets, mileage exactly at threshold), `completeReminder` recurrence math (month-end clamp e.g. Jan 31 + 1 month, one-shot → null, target-without-repeat dropped), `bumpCarMileage` (higher / equal / lower).
- `packages/contracts`: schema round-trips, at-least-one-target refine, repeat-requires-target refine, `optText` empty-string handling.
- `apps/api`: router tests with in-memory repos — CRUD, owner isolation, cap at 20, complete (repeating and one-shot), mileage bump on event create/update and on complete.
- `apps/web`: unit tests for urgency sort and relative due phrasing in `lib/`.
- Gates: `pnpm turbo run build lint typecheck test` green.