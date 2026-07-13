# Finish Car CRUD in the UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `GET/PUT/DELETE /cars/{id}` endpoints into the web UI — a Vehicle detail screen at `/cars/:id` reached by tapping a garage card, with Edit (shared create/edit dialog) and Delete (confirmation dialog).

**Architecture:** Frontend-only, extending the shipped MVP's patterns. Add three functions to the existing `api-client.ts` and three hooks to `queries.ts`; refactor `AddCarDialog` into a dual-mode `CarFormDialog`; add a `Vehicle` route and a reusable `ConfirmDialog`; make garage cards navigable.

**Tech Stack:** React 18, TypeScript (strict), Vite, MUI v6, TanStack Query v5, React Hook Form + zodResolver, react-router-dom v6, `@carlog/contracts` (Zod). No backend/CDK/contracts/domain changes.

## Global Constraints

- Strict TypeScript, never `any`. Prefer `type`; `interface` only for service abstractions.
- Zod is the contract source of truth; derive types with `z.infer`. No hand-written types duplicating a schema.
- Extensionless relative imports (`moduleResolution: "bundler"`).
- MUI only, mobile-first.
- No backend, contracts, domain, or CDK changes — this feature only touches `apps/web/src`.
- Reuse the existing `request<T>(token, path, schema, init?)` wrapper in `api-client.ts` (handles auth header, non-2xx → throw, `204 → undefined`, Zod parse). Do not add a second fetch path.
- Query keys: list = `['cars']`, detail = `['cars', id]`.
- Conventional commits; NO co-authorship trailers.
- Verification is web-only deploy via `scripts/deploy-web.sh` — NO backend redeploy.

## File Structure

```
apps/web/src/api-client.ts                 MODIFY  + getCar, updateCar, deleteCar
apps/web/src/queries.ts                    MODIFY  + useCar, useUpdateCar, useDeleteCar
apps/web/src/components/CarFormDialog.tsx   RENAME from AddCarDialog.tsx, add edit mode
apps/web/src/components/ConfirmDialog.tsx   CREATE  reusable confirm dialog
apps/web/src/routes/Vehicle.tsx            CREATE  /cars/:id detail + edit + delete
apps/web/src/routes/Garage.tsx             MODIFY  card navigation + import rename
apps/web/src/main.tsx                      MODIFY  + /cars/:id route
```

Note on testing: the shipped web app has no component test setup (no jsdom/RTL), and the spec keeps it that way (unit tests are for business logic, which is unchanged). Each task's gate is therefore `typecheck` + `lint` + `build` on the `@carlog/web` package. This is deliberate, not an omission.

---

### Task 1: API client — getCar, updateCar, deleteCar

**Files:**
- Modify: `apps/web/src/api-client.ts`

**Interfaces:**
- Consumes: existing `request<T>(token, path, schema, init?)`, `CarSchema`, `type Car`, `type CreateCarInput` (already imported/used in the file).
- Produces:
  - `getCar(token: string, id: string): Promise<Car>`
  - `updateCar(token: string, id: string, input: UpdateCarInput): Promise<Car>`
  - `deleteCar(token: string, id: string): Promise<void>`

- [ ] **Step 1: Read the current file to confirm the `request` signature and imports**

Run: `cat apps/web/src/api-client.ts`
Expected: confirms `request<T>(token, path, schema, init?)`, `CarSchema`, `CarListSchema`, and the existing `listCars`/`createCar` exports. (The current import line is `import { CarSchema, type Car, type CreateCarInput } from '@carlog/contracts';`.)

- [ ] **Step 2: Add `UpdateCarInput` to the contracts import**

Change the existing import line:

```ts
import { CarSchema, type Car, type CreateCarInput } from '@carlog/contracts';
```

to:

```ts
import { CarSchema, type Car, type CreateCarInput, type UpdateCarInput } from '@carlog/contracts';
```

- [ ] **Step 3: Append the three functions after the existing `createCar` export**

```ts
export const getCar = (token: string, id: string): Promise<Car> =>
  request(token, `/cars/${id}`, CarSchema);

export const updateCar = (token: string, id: string, input: UpdateCarInput): Promise<Car> =>
  request(token, `/cars/${id}`, CarSchema, { method: 'PUT', body: JSON.stringify(input) });

export const deleteCar = (token: string, id: string): Promise<void> =>
  request(token, `/cars/${id}`, CarSchema, { method: 'DELETE' });
```

Note: `deleteCar` returns `Promise<void>` — the API returns 204, and `request` returns `undefined` for 204 before it ever calls `schema.parse`, so passing `CarSchema` here is harmless (it is never invoked). This keeps all calls on the single `request` wrapper per the global constraints.

- [ ] **Step 4: Typecheck the web package**

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS, no errors.

- [ ] **Step 5: Lint the web package**

Run: `pnpm --filter @carlog/web lint`
Expected: PASS, no errors (no unused imports, no `any`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api-client.ts
git commit -m "feat(web): add getCar, updateCar, deleteCar API client functions"
```

---

### Task 2: Query hooks — useCar, useUpdateCar, useDeleteCar

**Files:**
- Modify: `apps/web/src/queries.ts`

**Interfaces:**
- Consumes: `getCar`, `updateCar`, `deleteCar` from Task 1; existing `useAuth`, `useQuery`, `useMutation`, `useQueryClient`; `type Car`, `type UpdateCarInput`.
- Produces:
  - `useCar(id: string)` — `useQuery<Car>`, key `['cars', id]`, enabled when `token && id`.
  - `useUpdateCar(id: string)` — `useMutation`, `mutationFn: (input: UpdateCarInput) => updateCar(token, id, input)`, invalidates `['cars']` and `['cars', id]`.
  - `useDeleteCar()` — `useMutation`, `mutationFn: (id: string) => deleteCar(token, id)`, invalidates `['cars']`.

- [ ] **Step 1: Replace the import lines at the top of `queries.ts`**

Current:

```ts
import type { CreateCarInput } from '@carlog/contracts';
import { createCar, listCars } from './api-client';
```

Replace with:

```ts
import type { CreateCarInput, UpdateCarInput } from '@carlog/contracts';
import { createCar, deleteCar, getCar, listCars, updateCar } from './api-client';
```

- [ ] **Step 2: Append the three hooks after the existing `useCreateCar`**

```ts
export function useCar(id: string) {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  return useQuery({
    queryKey: ['cars', id],
    queryFn: () => getCar(token, id),
    enabled: Boolean(token && id),
  });
}

export function useUpdateCar(id: string) {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCarInput) => updateCar(token, id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cars'] });
      void qc.invalidateQueries({ queryKey: ['cars', id] });
    },
  });
}

export function useDeleteCar() {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCar(token, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars'] }),
  });
}
```

- [ ] **Step 3: Typecheck the web package**

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS.

- [ ] **Step 4: Lint the web package**

Run: `pnpm --filter @carlog/web lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/queries.ts
git commit -m "feat(web): add useCar, useUpdateCar, useDeleteCar hooks"
```

---

### Task 3: CarFormDialog — refactor AddCarDialog into a dual-mode create/edit dialog

**Files:**
- Create: `apps/web/src/components/CarFormDialog.tsx` (via `git mv` from `AddCarDialog.tsx`)
- Delete: `apps/web/src/components/AddCarDialog.tsx` (the `git mv` removes it)
- Modify: `apps/web/src/routes/Garage.tsx` (update the import + usage)

**Interfaces:**
- Consumes: `useCreateCar` (existing), `useUpdateCar(id)` from Task 2; `CreateCarSchema`, `FuelTypeSchema`, `type CreateCarInput`, `type Car` from `@carlog/contracts`.
- Produces: `CarFormDialog` component with props:
  ```ts
  type CarFormDialogProps = {
    open: boolean;
    onClose: () => void;
    mode: 'create' | 'edit';
    car?: Car; // required when mode === 'edit'
  };
  ```

- [ ] **Step 1: Rename the file with git so history is preserved**

Run: `git mv apps/web/src/components/AddCarDialog.tsx apps/web/src/components/CarFormDialog.tsx`
Expected: file renamed, staged.

- [ ] **Step 2: Replace the entire contents of `apps/web/src/components/CarFormDialog.tsx`**

```tsx
import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
} from '@mui/material';
import { CreateCarSchema, FuelTypeSchema, type Car, type CreateCarInput } from '@carlog/contracts';
import { useCreateCar, useUpdateCar } from '../queries';

const FUEL_TYPES = FuelTypeSchema.options;

const EMPTY_DEFAULTS: CreateCarInput = { make: '', model: '', year: 2020, mileage: 0, fuelType: 'petrol' };

const toFormValues = (car: Car): CreateCarInput => ({
  make: car.make,
  model: car.model,
  year: car.year,
  mileage: car.mileage,
  fuelType: car.fuelType,
  nickname: car.nickname,
  vin: car.vin,
  licensePlate: car.licensePlate,
});

type CarFormDialogProps = {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  car?: Car;
};

export function CarFormDialog({ open, onClose, mode, car }: CarFormDialogProps) {
  const create = useCreateCar();
  const update = useUpdateCar(car?.id ?? '');
  const isPending = create.isPending || update.isPending;

  const { control, handleSubmit, reset, formState: { errors } } = useForm<CreateCarInput>({
    resolver: zodResolver(CreateCarSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  // Re-populate whenever the dialog opens (or the target car changes) so edit
  // shows the right vehicle and create starts blank.
  useEffect(() => {
    if (!open) return;
    reset(mode === 'edit' && car ? toFormValues(car) : EMPTY_DEFAULTS);
  }, [open, mode, car, reset]);

  const onSubmit = handleSubmit(async (data) => {
    if (mode === 'edit') {
      await update.mutateAsync(data);
    } else {
      await create.mutateAsync(data);
    }
    reset(EMPTY_DEFAULTS);
    onClose();
  });

  const text = (name: keyof CreateCarInput, label: string, type = 'text') => (
    <Controller name={name} control={control} render={({ field }) => (
      <TextField {...field} label={label} type={type} fullWidth
        value={field.value ?? ''}
        onChange={(e) => field.onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        error={Boolean(errors[name])} helperText={errors[name]?.message as string | undefined} />
    )} />
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={onSubmit}>
        <DialogTitle>{mode === 'edit' ? 'Edit car' : 'Add a car'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {text('make', 'Make')}
            {text('model', 'Model')}
            {text('year', 'Year', 'number')}
            {text('mileage', 'Mileage', 'number')}
            {text('nickname', 'Nickname')}
            {text('vin', 'VIN')}
            {text('licensePlate', 'License plate')}
            <Controller name="fuelType" control={control} render={({ field }) => (
              <TextField {...field} select label="Fuel type" fullWidth>
                {FUEL_TYPES.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
              </TextField>
            )} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isPending}>
            {mode === 'edit' ? 'Save changes' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 3: Update `Garage.tsx` to use `CarFormDialog` in create mode**

In `apps/web/src/routes/Garage.tsx`, change the import line:

```ts
import { AddCarDialog } from '../components/AddCarDialog';
```

to:

```ts
import { CarFormDialog } from '../components/CarFormDialog';
```

And change the usage near the bottom:

```tsx
<AddCarDialog open={open} onClose={() => setOpen(false)} />
```

to:

```tsx
<CarFormDialog open={open} onClose={() => setOpen(false)} mode="create" />
```

- [ ] **Step 4: Typecheck the web package**

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS.

- [ ] **Step 5: Lint the web package**

Run: `pnpm --filter @carlog/web lint`
Expected: PASS.

- [ ] **Step 6: Build the web package (confirms the create flow still compiles end-to-end)**

Run: `pnpm --filter @carlog/web build`
Expected: `vite build` succeeds, emits `apps/web/dist`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/CarFormDialog.tsx apps/web/src/routes/Garage.tsx
git commit -m "refactor(web): make CarFormDialog handle create and edit modes"
```

---

### Task 4: ConfirmDialog — reusable confirmation dialog

**Files:**
- Create: `apps/web/src/components/ConfirmDialog.tsx`

**Interfaces:**
- Produces: `ConfirmDialog` component with props:
  ```ts
  type ConfirmDialogProps = {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string; // default 'Delete'
    onConfirm: () => void;
    onClose: () => void;
    loading?: boolean;
  };
  ```

- [ ] **Step 1: Create `apps/web/src/components/ConfirmDialog.tsx`**

```tsx
import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from '@mui/material';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
};

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Delete', onConfirm, onClose, loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} color="error" variant="contained" disabled={loading}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck the web package**

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS.

- [ ] **Step 3: Lint the web package**

Run: `pnpm --filter @carlog/web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ConfirmDialog.tsx
git commit -m "feat(web): add reusable ConfirmDialog component"
```

---

### Task 5: Vehicle detail screen + routing + navigable cards

**Files:**
- Create: `apps/web/src/routes/Vehicle.tsx`
- Modify: `apps/web/src/main.tsx` (add the `/cars/:id` route)
- Modify: `apps/web/src/routes/Garage.tsx` (make cards navigate)

**Interfaces:**
- Consumes: `useCar(id)` from Task 2, `useDeleteCar()` from Task 2, `CarFormDialog` from Task 3, `ConfirmDialog` from Task 4; `useParams`, `useNavigate` from `react-router-dom`.
- Produces: `Vehicle` component (default export style matches sibling routes: `export function Vehicle()`).

- [ ] **Step 1: Create `apps/web/src/routes/Vehicle.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AppBar, Box, Button, CircularProgress, Container, IconButton, Stack, Toolbar, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { Car } from '@carlog/contracts';
import { useCar, useDeleteCar } from '../queries';
import { CarFormDialog } from '../components/CarFormDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography>{value}</Typography>
    </Stack>
  );
}

function VehicleDetail({ car }: { car: Car }) {
  const navigate = useNavigate();
  const del = useDeleteCar();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const title: string = car.nickname || `${car.make} ${car.model}`;

  const onDelete = async () => {
    await del.mutateAsync(car.id);
    navigate('/', { replace: true });
  };

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <IconButton edge="start" color="inherit" onClick={() => navigate('/')} aria-label="Back to garage">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>{title}</Typography>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 3 }}>
        <Stack spacing={0}>
          <DetailRow label="Make" value={car.make} />
          <DetailRow label="Model" value={car.model} />
          <DetailRow label="Year" value={car.year} />
          <DetailRow label="Mileage" value={`${car.mileage.toLocaleString()} mi`} />
          <DetailRow label="Fuel type" value={car.fuelType} />
          {car.nickname ? <DetailRow label="Nickname" value={car.nickname} /> : null}
          {car.vin ? <DetailRow label="VIN" value={car.vin} /> : null}
          {car.licensePlate ? <DetailRow label="License plate" value={car.licensePlate} /> : null}
        </Stack>
        <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
          <Button variant="contained" onClick={() => setEditOpen(true)}>Edit</Button>
          <Button color="error" onClick={() => setConfirmOpen(true)}>Delete</Button>
        </Stack>
      </Container>
      <CarFormDialog open={editOpen} onClose={() => setEditOpen(false)} mode="edit" car={car} />
      <ConfirmDialog
        open={confirmOpen}
        title="Delete car"
        message="Delete this car? This can't be undone."
        onConfirm={onDelete}
        onClose={() => setConfirmOpen(false)}
        loading={del.isPending}
      />
    </>
  );
}

export function Vehicle() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: car, isLoading, isError } = useCar(id);

  if (isLoading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
  }
  if (isError || !car) {
    return (
      <Container sx={{ py: 6, textAlign: 'center' }}>
        <Typography variant="h6" gutterBottom>Car not found</Typography>
        <Button variant="contained" onClick={() => navigate('/')}>Back to garage</Button>
      </Container>
    );
  }
  return <VehicleDetail car={car} />;
}
```

- [ ] **Step 2: Add the route in `apps/web/src/main.tsx`**

Add the import after the existing route imports:

```ts
import { Vehicle } from './routes/Vehicle';
```

Add the route inside `<Routes>`, after the `/` route:

```tsx
<Route path="/cars/:id" element={<RequireAuth><Vehicle /></RequireAuth>} />
```

- [ ] **Step 3: Make garage cards navigate to the detail screen**

In `apps/web/src/routes/Garage.tsx`:

Add `useNavigate` to the react-router-dom import (there is no existing react-router import in this file, so add a new import line near the top, after the react-oidc-context import):

```ts
import { useNavigate } from 'react-router-dom';
```

Inside the `Garage` component, add the hook near the existing `useState`:

```ts
const navigate = useNavigate();
```

Make the `Card` clickable by adding an `onClick` and pointer cursor. Change:

```tsx
<Grid item xs={12} sm={6} md={4} key={car.id}>
  <Card>
    <CardContent>
```

to:

```tsx
<Grid item xs={12} sm={6} md={4} key={car.id}>
  <Card onClick={() => navigate(`/cars/${car.id}`)} sx={{ cursor: 'pointer' }}>
    <CardContent>
```

- [ ] **Step 4: Typecheck the web package**

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS.

- [ ] **Step 5: Lint the web package**

Run: `pnpm --filter @carlog/web lint`
Expected: PASS.

- [ ] **Step 6: Build the web package**

Run: `pnpm --filter @carlog/web build`
Expected: `vite build` succeeds, emits `apps/web/dist`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/Vehicle.tsx apps/web/src/main.tsx apps/web/src/routes/Garage.tsx
git commit -m "feat(web): add Vehicle detail screen with edit and delete"
```

---

### Task 6: Full verification + web deploy

**Files:** none (verification + deploy).

- [ ] **Step 1: Run all repo gates**

Run: `pnpm turbo run typecheck lint test`
Expected: all packages PASS (contracts 6, domain 2, api 5 tests; all typecheck + lint green).

- [ ] **Step 2: Deploy the web app (web-only, no backend redeploy)**

Run: `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`
Expected: builds web, syncs to S3, invalidates CloudFront, prints `Deployed web to https://<cf-domain>`.

- [ ] **Step 3: Live smoke test (definition of done)**

On the deployed CloudFront URL, signed in as the existing test user:
1. Garage → tap a car card → Vehicle screen shows all details.
2. Edit → change mileage → Save changes → detail row and garage card both reflect the new mileage.
3. Delete → confirm dialog → Delete → returns to garage, the card is gone.
4. Reload the page → the deleted car stays gone (confirms the DynamoDB delete).

Expected: all four steps pass.

---

## Self-Review Notes

- **Spec coverage:** Layer 1 API client → Task 1; Layer 1 hooks → Task 2; Layer 2 CarFormDialog → Task 3; Layer 4 ConfirmDialog → Task 4; Layer 3 Vehicle screen + routing + navigable cards → Task 5; testing/verification → Task 6. All spec layers mapped.
- **No backend changes:** confirmed — every file touched is under `apps/web/src`. Verification is web-only deploy.
- **Type consistency:** `CarFormDialogProps` (`open/onClose/mode/car`), `ConfirmDialogProps` (`open/title/message/confirmLabel?/onConfirm/onClose/loading?`), `useCar(id)`, `useUpdateCar(id)`, `useDeleteCar()` (mutate takes `id`), `getCar/updateCar/deleteCar` signatures — all used identically across Tasks 1–5.
- **Query-key consistency:** `['cars']` and `['cars', id]` used the same way in `useCar`, `useUpdateCar`, `useDeleteCar`.
- **Known pattern note:** `deleteCar` passes `CarSchema` to `request` but the 204 path returns before parsing — documented in Task 1 Step 3 so a reviewer doesn't flag it as a bug or "unused schema".
- **Testing rationale:** the web package has no component-test harness (matches the shipped slice); gates are typecheck + lint + build per task, live smoke test at the end — stated in the File Structure note so a reviewer doesn't flag missing unit tests.
