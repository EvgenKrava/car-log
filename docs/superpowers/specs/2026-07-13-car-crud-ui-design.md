# Finish Car CRUD in the UI — Design

**Date:** 2026-07-13
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** the MVP thin slice (`2026-07-13-carlog-mvp-thin-slice-design.md`)

## Goal

The MVP thin slice shipped the create + list vertical for cars. The backend
already implements `PUT /cars/{id}` and `DELETE /cars/{id}` (fully tested,
verified live), and `GET /cars/{id}` exists — but the web UI only does create
and list. This feature wires those existing endpoints into the UI: a Vehicle
detail screen with Edit and Delete, reached by tapping a garage card.

**Frontend-only.** No backend, contracts, domain, or CDK changes.

## Locked Decisions

| Area | Decision |
|------|----------|
| Next feature | Finish car CRUD in the UI (edit + delete + vehicle detail) |
| Navigation | Dedicated Vehicle detail screen at `/cars/:id`; edit/delete live there |
| Edit UX | Reuse the Add dialog — refactor into a shared `CarFormDialog` (create + edit modes) |
| Delete UX | Simple confirmation dialog (matches backend hard-delete) |
| Build strategy | Approach A — extend the existing api-client / queries pattern; no restructure |

## Layer 1 — API client + query hooks

Extend the two existing files; no new API infrastructure.

**`apps/web/src/api-client.ts`** — add three functions using the existing
`request<T>(token, path, schema, init?)` wrapper (which already handles the
`Authorization: Bearer` header, non-2xx → throw, `204 → undefined`, and Zod
response parsing):

```ts
getCar(token: string, id: string): Promise<Car>
  → GET /cars/{id}, parsed with CarSchema
updateCar(token: string, id: string, input: UpdateCarInput): Promise<Car>
  → PUT /cars/{id}, body = input, parsed with CarSchema
deleteCar(token: string, id: string): Promise<void>
  → DELETE /cars/{id}  (204, no body)
```

`UpdateCarInput` already exists (`UpdateCarSchema = CreateCarSchema.partial()`).
Edit submits the full form (all fields); a complete object still validates
against the partial schema.

**`apps/web/src/queries.ts`** — add three hooks:

```ts
useCar(id: string)        // useQuery, key ['cars', id], enabled when token && id
useUpdateCar(id: string)  // useMutation(updateCar) → invalidate ['cars'] and ['cars', id]
useDeleteCar()            // useMutation(deleteCar) → invalidate ['cars']
```

Query-key convention: list = `['cars']`, detail = `['cars', id]` (hierarchical
TanStack keys, so mutating a car refreshes both its detail and the list).

## Layer 2 — Shared CarFormDialog (create + edit)

Refactor the existing `AddCarDialog.tsx` into `CarFormDialog.tsx` — one
component, two modes. Rename the file (update the Garage import) rather than
leaving a misleadingly-named component.

```ts
type CarFormDialogProps = {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  car?: Car; // required when mode === 'edit'; pre-fills the form
};
```

- Same 8 fields, same `zodResolver(CreateCarSchema)` validation for both modes.
- Defaults: create → current empty defaults; edit → mapped from `car` via RHF
  `reset(...)` when the dialog opens or `car` changes (so re-opening on a
  different vehicle re-populates correctly).
- Submit branches on mode: create → `useCreateCar()`; edit →
  `useUpdateCar(car.id)`. Both reset + close on success.
- Title / button text switch on mode ("Add a car" / "Save" vs "Edit car" /
  "Save changes").

Garage keeps using it in `create` mode via its FAB (behavior unchanged). The
Vehicle screen uses it in `edit` mode.

## Layer 3 — Vehicle detail screen + routing

**New `apps/web/src/routes/Vehicle.tsx`** at `/cars/:id` (guarded by
`RequireAuth`, like Garage):

- Reads `id` from the route param; calls `useCar(id)`.
- States: loading → spinner; not-found/error (404 from a bad or deleted id) →
  "Car not found" message + back-to-garage button; success → detail view.
- Detail view: AppBar with back navigation + the car's title (nickname or
  `make model`). Body shows fields as read-only rows (make, model, year,
  mileage, fuelType, plus vin/licensePlate/nickname when present — omit empty
  optionals). Actions: **Edit** (opens `CarFormDialog` edit mode) and
  **Delete** (opens the confirm dialog).
- Delete flow: confirm dialog → `useDeleteCar()` → on success navigate to `/`.
  The list is invalidated by the hook, so the deleted card disappears.

**`apps/web/src/main.tsx`:** add
`<Route path="/cars/:id" element={<RequireAuth><Vehicle /></RequireAuth>} />`.

**`apps/web/src/routes/Garage.tsx`:** each card becomes navigable —
clicking calls `navigate('/cars/' + car.id)`. The FAB (create) is unchanged.

## Layer 4 — ConfirmDialog

**New `apps/web/src/components/ConfirmDialog.tsx`** — a small reusable MUI
dialog:

```ts
type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string; // default "Delete"
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;     // disables confirm while the mutation runs
};
```

Used by the Vehicle screen for delete ("Delete this car? This can't be
undone."). Generic enough to reuse for future destructive actions.

## Testing

Consistent with the shipped slice (unit-test business logic, not React
components):

- No backend changes → no new API/domain tests. `PUT`/`DELETE` routes and repo
  methods are already covered by the `apps/api` router tests (5 tests) and were
  verified live.
- Static gates are the frontend net: `pnpm --filter @carlog/web typecheck`
  (strict, no `any`) + `eslint` + `pnpm --filter @carlog/web build` must pass.
- Full repo gate `pnpm turbo run typecheck lint test` stays green.

## Verification (definition of done)

On the deployed app (reuses the existing test user; web-only deploy via
`scripts/deploy-web.sh`, no backend redeploy):

1. Open a car → Vehicle screen shows details.
2. Edit → change mileage → save → detail and garage both reflect the change.
3. Delete → confirm → returns to garage, card gone.
4. Reload → car stays gone (confirms the DynamoDB delete).

## Scope Guard (YAGNI)

Out of scope: new car fields, soft-delete/undo, optimistic updates,
pagination, feature-folder restructure (deferred until Events arrives). This
feature only wires existing endpoints into the two documented screens.

## Files

```
apps/web/src/api-client.ts            MODIFY  + getCar, updateCar, deleteCar
apps/web/src/queries.ts               MODIFY  + useCar, useUpdateCar, useDeleteCar
apps/web/src/components/CarFormDialog.tsx   RENAME from AddCarDialog.tsx + edit mode
apps/web/src/components/ConfirmDialog.tsx   CREATE
apps/web/src/routes/Vehicle.tsx       CREATE
apps/web/src/routes/Garage.tsx        MODIFY  card navigation + import rename
apps/web/src/main.tsx                 MODIFY  + /cars/:id route
```
