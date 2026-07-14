# CarLog UI Redesign (Clean Modern SaaS) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CarLog's default-Material look with a distinctive "clean modern SaaS" design — token-driven MUI theme (intentional light + dark), self-hosted Inter, and bespoke shared components — across every owned screen, with zero behavior change.

**Architecture:** MUI stays for behavior; a design-token layer + rebuilt MUI theme (with `components` default overrides) supplies the look, and a small set of bespoke primitives (`AppShell`, `PageHeader`, `VehicleCard`, `EmptyState`, `StatusView`) are composed into the existing screens. Screens keep their existing hooks/routing/auth untouched.

**Tech Stack:** React 18, TypeScript (strict), Vite 5.4, MUI v6 (`@mui/material`, `@mui/icons-material`), `@fontsource/inter`, TanStack Query (unchanged), react-router (unchanged). Design skills: `interface-design` (system lock), `frontend-design` (component craft).

## Global Constraints

- **Frontend-only, visual-only.** Only `apps/web/**` and `.interface-design/`. NO changes to behavior/logic, hooks, API, contracts, domain, or CDK.
- Strict TypeScript, never `any`. Prefer `type`; `interface` only for service abstractions.
- Extensionless relative imports.
- **MUI only** — no Tailwind/other UI libs. Only new dependency allowed: `@fontsource/inter`.
- Auto light + dark via the existing `prefers-color-scheme` wiring in `main.tsx` — do NOT add a manual toggle; do NOT change how `buildTheme(mode)` is selected, only its contents.
- Move OFF the default accent `#1565c0`. Final accent hue is locked in `.interface-design/system.md` (Task 1) and every later task reads it from `apps/web/src/theme/tokens.ts` — no hardcoded colors in components.
- Fonts self-hosted (bundled) so the app-shell service worker precaches them; NO external font CDN. SW must still NOT cache the API.
- Per-task gates (no new unit logic in visual work): `pnpm --filter @carlog/web typecheck` + `lint` + `build`. Existing `resolveInstallMode` tests (6) stay green.
- Conventional commits; NO co-authorship trailers.

## File Structure

```
.interface-design/system.md                  CREATE  locked design system (Task 1)
apps/web/src/theme/tokens.ts                  CREATE  color/type/space/radius/shadow tokens (Task 1)
apps/web/package.json                         MODIFY  + @fontsource/inter (Task 1)
apps/web/src/theme.ts                         MODIFY  rebuild buildTheme from tokens + component overrides (Task 2)
apps/web/src/main.tsx                         MODIFY  import Inter font css (Task 2; buildTheme wiring unchanged)
apps/web/src/components/ui/AppShell.tsx       CREATE  (Task 3)
apps/web/src/components/ui/PageHeader.tsx     CREATE  (Task 3)
apps/web/src/components/ui/EmptyState.tsx     CREATE  (Task 3)
apps/web/src/components/ui/StatusView.tsx     CREATE  (Task 3)
apps/web/src/components/ui/VehicleCard.tsx    CREATE  (Task 3)
apps/web/src/routes/Garage.tsx                MODIFY  compose primitives (Task 4)
apps/web/src/routes/Vehicle.tsx               MODIFY  compose primitives + detail layout (Task 5)
apps/web/src/routes/Callback.tsx             MODIFY  themed loader (Task 5)
apps/web/src/components/CarFormDialog.tsx     MODIFY  themed polish, no logic change (Task 6)
apps/web/src/components/ConfirmDialog.tsx     MODIFY  themed polish (Task 6)
apps/web/src/components/InstallPrompt.tsx     MODIFY  themed + FAB-overlap fix (Task 6)
```

Task order: system+tokens+font (1) → theme (2) → primitives (3) → Garage (4) → Vehicle+Callback (5) → dialogs+InstallPrompt (6) → verify+deploy (7). Theme (2) transforms all screens immediately; primitives and screen tasks layer cohesion on top.

---

### Task 1: Lock the design system + tokens + Inter font

**Files:**
- Create: `.interface-design/system.md`
- Create: `apps/web/src/theme/tokens.ts`
- Modify: `apps/web/package.json` (add `@fontsource/inter`)

**Interfaces:**
- Produces: `tokens` — a typed object other files import. Exact shape:
  ```ts
  export const tokens: {
    color: {
      accent: string; accentHover: string;
      light: { bg: string; surface: string; border: string; textPrimary: string; textSecondary: string };
      dark:  { bg: string; surface: string; border: string; textPrimary: string; textSecondary: string };
      success: string; error: string; warning: string;
    };
    radius: { sm: number; md: number; lg: number };
    shadow: { sm: string; md: string };
    font: { family: string };
  }
  ```

- [ ] **Step 1: Invoke the `interface-design` skill and write `.interface-design/system.md`**

Run the `interface-design` skill (per the project's mandate). Produce `.interface-design/system.md` stating: audience (individual car owners keeping a personal maintenance history); intent (calm, trustworthy, premium-but-simple); the signature element; and REJECTED defaults (default-MUI blue `#1565c0`, harsh-shadow/flat cards, cramped dialogs, bare spinners, uppercase buttons). Lock the accent hue — default to indigo/violet `#5B5BD6` (hover `#4A4AC4`) unless the skill's exploration produces a stronger choice; whatever is chosen becomes the single source in `system.md` and must match `tokens.ts` below.

- [ ] **Step 2: Add `@fontsource/inter` to `apps/web/package.json`**

Add to `dependencies`: `"@fontsource/inter": "^5.1.0"`. Then run `pnpm install` from repo root.
Expected: installs; `@fontsource/inter` linked into `apps/web`.

- [ ] **Step 3: Create `apps/web/src/theme/tokens.ts`**

Use the accent locked in `system.md` (indigo `#5B5BD6` shown here; keep the two in sync):

```ts
export const tokens = {
  color: {
    accent: '#5B5BD6',
    accentHover: '#4A4AC4',
    light: {
      bg: '#F7F8FA',
      surface: '#FFFFFF',
      border: '#E6E8EC',
      textPrimary: '#1A1C1F',
      textSecondary: '#5C6370',
    },
    dark: {
      bg: '#0F1115',
      surface: '#181B20',
      border: '#262A31',
      textPrimary: '#F2F3F5',
      textSecondary: '#A0A6B0',
    },
    success: '#2E9E6B',
    error: '#D64545',
    warning: '#C9861A',
  },
  radius: { sm: 8, md: 12, lg: 16 },
  shadow: {
    sm: '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)',
    md: '0 4px 12px rgba(16,24,40,0.08), 0 2px 6px rgba(16,24,40,0.06)',
  },
  font: { family: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
} as const;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @carlog/web typecheck`
Expected: PASS (tokens.ts compiles; nothing imports it yet).

- [ ] **Step 5: Commit**

```bash
git add .interface-design/system.md apps/web/src/theme/tokens.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): lock design system and add design tokens + Inter font dep"
```

---

### Task 2: Rebuild the MUI theme from tokens

**Files:**
- Modify: `apps/web/src/theme.ts`
- Modify: `apps/web/src/main.tsx` (import Inter font CSS)

**Interfaces:**
- Consumes: `tokens` from `./theme/tokens` (Task 1).
- Produces: `buildTheme(mode: 'light' | 'dark'): Theme` — same signature as today, new contents. `main.tsx`'s existing call `buildTheme(prefersDark ? 'dark' : 'light')` is unchanged.

- [ ] **Step 1: Replace `apps/web/src/theme.ts`**

```ts
import { createTheme, type Theme } from '@mui/material/styles';
import { tokens } from './theme/tokens';

export const buildTheme = (mode: 'light' | 'dark'): Theme => {
  const c = mode === 'dark' ? tokens.color.dark : tokens.color.light;
  return createTheme({
    palette: {
      mode,
      primary: { main: tokens.color.accent, dark: tokens.color.accentHover },
      success: { main: tokens.color.success },
      error: { main: tokens.color.error },
      warning: { main: tokens.color.warning },
      background: { default: c.bg, paper: c.surface },
      text: { primary: c.textPrimary, secondary: c.textSecondary },
      divider: c.border,
    },
    shape: { borderRadius: tokens.radius.md },
    typography: {
      fontFamily: tokens.font.family,
      h5: { fontWeight: 700, letterSpacing: '-0.02em' },
      h6: { fontWeight: 700, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 600 },
      button: { fontWeight: 600 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { textTransform: 'none', borderRadius: tokens.radius.sm },
        },
      },
      MuiPaper: {
        styleOverrides: { rounded: { borderRadius: tokens.radius.md } },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.lg,
            border: `1px solid ${c.border}`,
            boxShadow: tokens.shadow.sm,
            backgroundImage: 'none',
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'default' },
        styleOverrides: {
          root: {
            backgroundColor: c.surface,
            color: c.textPrimary,
            borderBottom: `1px solid ${c.border}`,
            backgroundImage: 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: tokens.radius.lg } },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiChip: { styleOverrides: { root: { borderRadius: tokens.radius.sm, fontWeight: 600 } } },
    },
  });
};
```

- [ ] **Step 2: Import the Inter font in `apps/web/src/main.tsx`**

Add these imports at the very top of the import block (before other imports so the font CSS loads first):

```ts
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
```

Leave the rest of `main.tsx` unchanged (the `buildTheme(prefersDark ? 'dark' : 'light')` wiring stays).

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint`
Expected: both PASS.

- [ ] **Step 4: Build (confirms font imports resolve + bundle)**

Run: `pnpm --filter @carlog/web build`
Expected: `vite build` succeeds; the Inter woff2 files are emitted into `dist/assets`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/theme.ts apps/web/src/main.tsx
git commit -m "feat(web): rebuild MUI theme from design tokens with Inter and component overrides"
```

---

### Task 3: Bespoke shared primitives

**Files:**
- Create: `apps/web/src/components/ui/AppShell.tsx`
- Create: `apps/web/src/components/ui/PageHeader.tsx`
- Create: `apps/web/src/components/ui/EmptyState.tsx`
- Create: `apps/web/src/components/ui/StatusView.tsx`
- Create: `apps/web/src/components/ui/VehicleCard.tsx`

**Interfaces:**
- Consumes: MUI components; `type Car` from `@carlog/contracts` (VehicleCard).
- Produces:
  - `AppShell({ children }: { children: ReactNode })` — app frame with bottom safe-padding.
  - `PageHeader({ title, onBack?, actions? }: { title: string; onBack?: () => void; actions?: ReactNode })`.
  - `EmptyState({ title, description, action? }: { title: string; description?: string; action?: ReactNode })`.
  - `StatusView({ state, message? }: { state: 'loading' | 'error'; message?: string })`.
  - `VehicleCard({ car, onClick }: { car: Car; onClick: () => void })`.

- [ ] **Step 1: Create `apps/web/src/components/ui/AppShell.tsx`**

```tsx
import { type ReactNode } from 'react';
import { Box } from '@mui/material';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {children}
      {/* Safe bottom padding so the FAB and InstallPrompt banner never cover content. */}
      <Box sx={{ height: 96 }} />
    </Box>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/components/ui/PageHeader.tsx`**

```tsx
import { type ReactNode } from 'react';
import { AppBar, Box, IconButton, Toolbar, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export function PageHeader({
  title, onBack, actions,
}: { title: string; onBack?: () => void; actions?: ReactNode }) {
  return (
    <AppBar position="sticky">
      <Toolbar>
        {onBack ? (
          <IconButton edge="start" onClick={onBack} aria-label="Back" sx={{ mr: 1 }}>
            <ArrowBackIcon />
          </IconButton>
        ) : null}
        <Typography variant="h6" sx={{ flexGrow: 1 }}>{title}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>{actions}</Box>
      </Toolbar>
    </AppBar>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/components/ui/EmptyState.tsx`**

```tsx
import { type ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';

export function EmptyState({
  title, description, action,
}: { title: string; description?: string; action?: ReactNode }) {
  return (
    <Stack alignItems="center" spacing={2} sx={{ py: 8, textAlign: 'center' }}>
      <Box sx={{
        width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center',
        bgcolor: 'action.hover', color: 'text.secondary',
      }}>
        <DirectionsCarIcon fontSize="large" />
      </Box>
      <Typography variant="h6">{title}</Typography>
      {description ? <Typography color="text.secondary">{description}</Typography> : null}
      {action}
    </Stack>
  );
}
```

- [ ] **Step 4: Create `apps/web/src/components/ui/StatusView.tsx`**

```tsx
import { Box, CircularProgress, Stack, Typography } from '@mui/material';

export function StatusView({
  state, message,
}: { state: 'loading' | 'error'; message?: string }) {
  if (state === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 10, textAlign: 'center' }}>
      <Typography variant="h6">Something went wrong</Typography>
      <Typography color="text.secondary">{message ?? 'Please try again.'}</Typography>
    </Stack>
  );
}
```

- [ ] **Step 5: Create `apps/web/src/components/ui/VehicleCard.tsx`**

```tsx
import { Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material';
import type { Car } from '@carlog/contracts';

export function VehicleCard({ car, onClick }: { car: Car; onClick: () => void }) {
  const title = car.nickname || `${car.make} ${car.model}`;
  return (
    <Card sx={{ transition: 'box-shadow .15s, transform .15s', '&:hover': { transform: 'translateY(-2px)' } }}>
      <CardActionArea onClick={onClick} sx={{ p: 0.5 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="h6" noWrap>{title}</Typography>
            <Chip label={car.fuelType} size="small" color="primary" variant="outlined" />
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {car.year} · {car.mileage.toLocaleString()} mi
          </Typography>
          {car.nickname ? (
            <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.5 }}>
              {car.make} {car.model}
            </Typography>
          ) : null}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
```

- [ ] **Step 6: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS (primitives compile; not yet used — build tree-shakes them, that's fine).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui
git commit -m "feat(web): add AppShell, PageHeader, EmptyState, StatusView, VehicleCard primitives"
```

---

### Task 4: Restyle Garage with the primitives

**Files:**
- Modify: `apps/web/src/routes/Garage.tsx`

**Interfaces:**
- Consumes: `AppShell`, `PageHeader`, `EmptyState`, `StatusView`, `VehicleCard` (Task 3); existing `useCars` and `CarFormDialog` (unchanged); `useAuth`, `useNavigate`.

- [ ] **Step 1: Replace `apps/web/src/routes/Garage.tsx`**

Keep all existing behavior (`useCars`, FAB opens create dialog, sign-out, navigate to `/cars/:id`). New composition:

```tsx
import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
import { Button, Container, Fab, Grid } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useCars } from '../queries';
import { CarFormDialog } from '../components/CarFormDialog';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusView } from '../components/ui/StatusView';
import { VehicleCard } from '../components/ui/VehicleCard';

export function Garage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { data: cars, isLoading, isError } = useCars();
  const [open, setOpen] = useState(false);

  return (
    <AppShell>
      <PageHeader
        title="CarLog"
        actions={<Button color="inherit" onClick={() => void auth.signoutRedirect()}>Sign out</Button>}
      />
      <Container sx={{ py: 3 }}>
        {isLoading ? (
          <StatusView state="loading" />
        ) : isError ? (
          <StatusView state="error" message="Could not load your garage." />
        ) : !cars?.length ? (
          <EmptyState
            title="Add your first car"
            description="Start keeping a maintenance history for every vehicle you own."
            action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Add a car</Button>}
          />
        ) : (
          <Grid container spacing={2}>
            {cars.map((car) => (
              <Grid item xs={12} sm={6} md={4} key={car.id}>
                <VehicleCard car={car} onClick={() => navigate(`/cars/${car.id}`)} />
              </Grid>
            ))}
          </Grid>
        )}
      </Container>
      <Fab color="primary" onClick={() => setOpen(true)} aria-label="Add car"
        sx={{ position: 'fixed', bottom: 24, right: 24 }}>
        <AddIcon />
      </Fab>
      <CarFormDialog open={open} onClose={() => setOpen(false)} mode="create" />
    </AppShell>
  );
}
```

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/Garage.tsx
git commit -m "feat(web): restyle Garage with shell, cards, empty and status states"
```

---

### Task 5: Restyle Vehicle detail + Callback

**Files:**
- Modify: `apps/web/src/routes/Vehicle.tsx`
- Modify: `apps/web/src/routes/Callback.tsx`

**Interfaces:**
- Consumes: `AppShell`, `PageHeader`, `StatusView` (Task 3); existing `useCar`, `useDeleteCar`, `CarFormDialog`, `ConfirmDialog` (unchanged); `useParams`, `useNavigate`.

- [ ] **Step 1: Replace `apps/web/src/routes/Vehicle.tsx`**

Keep all behavior (load car, edit dialog, delete→confirm→navigate home, not-found handling). New layout uses a definition-list-style spec panel and a fuel chip.

```tsx
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Button, Card, CardContent, Chip, Container, Stack, Typography } from '@mui/material';
import type { Car } from '@carlog/contracts';
import { useCar, useDeleteCar } from '../queries';
import { CarFormDialog } from '../components/CarFormDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusView } from '../components/ui/StatusView';

function SpecRow({ label, value }: { label: string; value: string | number }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ fontWeight: 500 }}>{value}</Typography>
    </Stack>
  );
}

function VehicleDetail({ car }: { car: Car }) {
  const navigate = useNavigate();
  const del = useDeleteCar();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const title = car.nickname || `${car.make} ${car.model}`;
  const onDelete = async () => { await del.mutateAsync(car.id); navigate('/', { replace: true }); };

  return (
    <AppShell>
      <PageHeader
        title={title}
        onBack={() => navigate('/')}
        actions={
          <>
            <Button variant="contained" onClick={() => setEditOpen(true)}>Edit</Button>
            <Button color="error" onClick={() => setConfirmOpen(true)}>Delete</Button>
          </>
        }
      />
      <Container sx={{ py: 3 }}>
        <Card>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6">{car.make} {car.model}</Typography>
              <Chip label={car.fuelType} color="primary" variant="outlined" />
            </Stack>
            <SpecRow label="Year" value={car.year} />
            <SpecRow label="Mileage" value={`${car.mileage.toLocaleString()} mi`} />
            {car.nickname ? <SpecRow label="Nickname" value={car.nickname} /> : null}
            {car.vin ? <SpecRow label="VIN" value={car.vin} /> : null}
            {car.licensePlate ? <SpecRow label="License plate" value={car.licensePlate} /> : null}
          </CardContent>
        </Card>
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
      {del.isError ? (
        <Container><Typography color="error" sx={{ mt: 1 }}>Failed to delete. Please try again.</Typography></Container>
      ) : null}
      <Box />
    </AppShell>
  );
}

export function Vehicle() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: car, isLoading, isError } = useCar(id);

  if (isLoading) return <AppShell><StatusView state="loading" /></AppShell>;
  if (isError || !car) {
    return (
      <AppShell>
        <Container sx={{ py: 8, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>Car not found</Typography>
          <Button variant="contained" onClick={() => navigate('/')}>Back to garage</Button>
        </Container>
      </AppShell>
    );
  }
  return <VehicleDetail car={car} />;
}
```

Note: preserves the prior review's fix — `del.isError` surfaces a delete failure message (do not drop it).

- [ ] **Step 2: Replace `apps/web/src/routes/Callback.tsx` with a themed loader**

Keep the existing effect logic (redirect to `/` once authenticated); only restyle the fallback UI:

```tsx
import { useEffect } from 'react';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';

export function Callback() {
  const auth = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated) navigate('/', { replace: true });
  }, [auth.isLoading, auth.isAuthenticated, navigate]);
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', bgcolor: 'background.default' }}>
      <CircularProgress />
    </Box>
  );
}
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/Vehicle.tsx apps/web/src/routes/Callback.tsx
git commit -m "feat(web): restyle Vehicle detail and Callback loader"
```

---

### Task 6: Polish dialogs + InstallPrompt (themed + FAB-overlap fix)

**Files:**
- Modify: `apps/web/src/components/CarFormDialog.tsx`
- Modify: `apps/web/src/components/ConfirmDialog.tsx`
- Modify: `apps/web/src/components/InstallPrompt.tsx`

**Interfaces:**
- No prop/signature changes — visual polish only. All existing behavior (create/edit submit, error alerts, confirm loading, install/dismiss logic) preserved.

- [ ] **Step 1: CarFormDialog — add breathing room, keep logic**

In `apps/web/src/components/CarFormDialog.tsx`, change ONLY the `<DialogContent>` opening tag to add top padding so the first field isn't clipped under the title, and ensure the Stack spacing is comfortable. Locate:

```tsx
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
```

Replace with:

```tsx
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
```

Do not touch the form logic, the error Alert, the fields, or the actions.

- [ ] **Step 2: ConfirmDialog — no structural change needed; verify it inherits the theme**

`ConfirmDialog.tsx` already uses MUI `Dialog`/`Button` which now inherit the rounded/error styling from the theme (Task 2). Make ONE change: give the destructive action clearer emphasis by ensuring the confirm button keeps `color="error" variant="contained"` (it already does). No edit required unless it diverges; if unchanged, skip to Step 3. (This step exists so the reviewer confirms ConfirmDialog looks right under the new theme.)

- [ ] **Step 3: InstallPrompt — theme polish + FAB-overlap fix**

The banner is `position: fixed; bottom: 0` full-width and covers the Garage FAB (`bottom: 24; right: 24`) while visible (prior review Minor). Fix by making the banner not span under the FAB on the right and rounding its top corners. In `apps/web/src/components/InstallPrompt.tsx`, locate the `<Paper ... sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: (t) => t.zIndex.snackbar, p: 2, borderRadius: 0 }}>` and replace that `sx` with:

```tsx
      sx={{
        position: 'fixed', left: 16, right: 16, bottom: 16,
        zIndex: (t) => t.zIndex.snackbar,
        p: 2, borderRadius: 3, maxWidth: 560, mx: 'auto',
      }}
```

This insets the banner (so it reads as a floating card, matching the SaaS look) and — being centered with `maxWidth` — no longer sits under the bottom-right FAB. Keep the banner's inner `Stack`/`Button` structure and all `usePwaInstall` logic unchanged.

- [ ] **Step 4: Typecheck + lint + build**

Run: `pnpm --filter @carlog/web typecheck && pnpm --filter @carlog/web lint && pnpm --filter @carlog/web build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/CarFormDialog.tsx apps/web/src/components/ConfirmDialog.tsx apps/web/src/components/InstallPrompt.tsx
git commit -m "feat(web): polish dialogs and inset InstallPrompt banner clear of the FAB"
```

---

### Task 7: Full verification + web deploy

**Files:** none (verification + deploy).

- [ ] **Step 1: Run all repo gates**

Run: `pnpm turbo run typecheck lint test`
Expected: all packages PASS — contracts 6, domain 2, api 6, web 6 (resolveInstallMode) tests; all typecheck + lint green.

- [ ] **Step 2: Confirm the service worker still excludes the API (redesign didn't regress it)**

Run: `pnpm --filter @carlog/web build && grep -c 'execute-api' apps/web/dist/sw.js`
Expected: `0` (SW still precaches app shell only — now including the Inter woff2 fonts — and never the API).

- [ ] **Step 3: Deploy web (web-only, no backend redeploy)**

Run: `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`
Expected: builds, syncs, re-uploads sw.js/manifest no-cache, invalidates CloudFront, prints `Deployed web to https://<cf-domain>`.

- [ ] **Step 4: Live smoke test (definition of done)**

On the deployed CloudFront URL, signed in:
1. Light mode: Garage shows the new theme — Inter type, inset cards with hover lift, fuel chips, flat app bar. Add a car (FAB or empty-state CTA) works.
2. Tap a card → Vehicle detail shows the new spec layout + chip; Edit and Delete work end-to-end (create/edit/delete flows intact).
3. Toggle OS to dark mode, reload: dark palette renders intentionally (layered charcoals, not pure black), text legible.
4. InstallPrompt banner (mobile/eligible): appears as an inset floating card and does NOT cover the FAB; Install/dismiss still work.
5. Network tab: `GET /cars` + Cognito still hit the network (not the SW).

Expected: all five pass.

---

## Self-Review Notes

- **Spec coverage:** Layer 1 system+tokens+font → Task 1; Layer 2 theme rebuild → Task 2; Layer 3 primitives → Task 3; Layer 4 screen restyles → Tasks 4 (Garage), 5 (Vehicle+Callback), 6 (dialogs+InstallPrompt); Layer 5 fonts/testing/verification → Tasks 1 (font dep), 7 (gates+deploy+smoke). All spec layers mapped.
- **Frontend-only:** every file under `apps/web/**` or `.interface-design/`. No API/domain/CDK/contracts changes. Behavior preserved (hooks, routing, auth, mutations, full-replace PUT, delete-error surfacing all untouched).
- **Placeholder scan:** no TBD/TODO; the accent hue is concretely specified (`#5B5BD6`) with the `system.md` lock noted as the source of truth; every code step shows full content.
- **Type consistency:** `tokens` shape (Task 1) consumed by `theme.ts` (Task 2); primitive prop signatures (`AppShell`/`PageHeader`/`EmptyState`/`StatusView`/`VehicleCard`, Task 3) used identically in Garage (Task 4) and Vehicle (Task 5); `buildTheme(mode)` signature unchanged so `main.tsx` wiring holds.
- **No-regression guards:** Task 5 explicitly preserves the delete-error message; Task 7 Step 2 re-asserts `execute-api == 0` so the redesign can't accidentally reintroduce API caching; Task 6 keeps all InstallPrompt logic while fixing the FAB overlap flagged in the PWA final review.
- **Testing rationale:** visual work adds no branching logic; per-task gates are typecheck+lint+build, existing tests stay green, live smoke test is the visual acceptance — stated so a reviewer doesn't flag missing unit tests.
- **Design tooling:** Task 1 Step 1 runs `interface-design` and produces `.interface-design/system.md` per the project mandate; `frontend-design` informs the component craft in Tasks 3–6.
