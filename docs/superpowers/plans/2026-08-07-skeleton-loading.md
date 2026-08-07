# Skeleton Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Content-shaped skeleton placeholders replace loading spinners at 9 sites; spinners remain only for genuine operations.

**Architecture:** One `skeletons.tsx` file of small presentation components (MUI `Skeleton`, wave animation, dimensions mirroring each real component); `StatusView` gains an optional `skeleton` prop; consumers pass their skeleton. Skeletons render on `isLoading` only — never on background refetch.

**Tech Stack:** MUI `Skeleton`, React. No new dependencies, no logic, no backend.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-07-skeleton-loading-design.md` is authoritative — including its "deliberately kept as spinners" list. Do NOT convert auth gates, RecordingBar, ScanInvoiceDialog, BatchUploadStatus, or the chat "Thinking…" state.
- 3 placeholder items per list skeleton. `animation="wave"`. Dimensions close enough to the loaded state that the swap doesn't shift surrounding content.
- Skeletons on `isLoading` only (never branch on `isFetching`).
- Strict TS never `any`; MUI only; no TODO/stubs; trailing newline; conventional commits NO trailers; gates `pnpm turbo run build lint typecheck test` per task.
- Branch: `feat/skeleton-loading`.

---

### Task 1: Skeleton components + StatusView prop

**Files:**
- Create: `apps/web/src/components/ui/skeletons.tsx`
- Modify: `apps/web/src/components/ui/StatusView.tsx`
- Modify: `.interface-design/system.md`

**Interfaces:**
- Produces: `VehicleCardSkeleton`, `TimelineEntrySkeleton`, `ReminderCardSkeleton`, `ChatSessionRowSkeleton`, `ChatBubbleSkeleton`, `VehicleHeroSkeleton`, `DashboardTilesSkeleton`, `UserRowSkeleton` — all `() => JSX.Element`, no props. `StatusView` gains `skeleton?: ReactNode`.

- [ ] **Step 1: Design-system addendum**

Append to `.interface-design/system.md` under Locked Decisions:

```markdown
### Loading States
- **Skeletons for content with a knowable shape** (lists, cards, heroes, stat tiles) — MUI Skeleton, wave animation, sized to the real component so content appears without layout shift; 3 placeholder items per list.
- **Spinners only for operations** (transcribing, scanning, uploading, auth redirects) — there is no layout to mimic.
- Skeletons render on initial load only; background refetches keep stale content visible and never re-skeleton.
```

- [ ] **Step 2: The skeleton components**

Create `apps/web/src/components/ui/skeletons.tsx`. Before writing each component, read its
real counterpart and mirror the structure — the code below is the reference; adjust
dimensions if the real component differs from what's shown here:

```tsx
import { Box, Card, CardContent, Skeleton, Stack } from '@mui/material';

// Content-shaped loading placeholders (design system: skeletons for content, spinners
// for operations). Each mirrors its real component's layout closely enough that the
// loaded content replaces it without shifting anything around it. The global
// prefers-reduced-motion clamp silences the wave animation.

// Mirrors VehicleCard: title row w/ chip, year/mileage line, reserved nickname line.
export function VehicleCardSkeleton() {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Skeleton animation="wave" width="55%" height={28} />
          <Skeleton animation="wave" variant="rounded" width={64} height={24} />
        </Stack>
        <Skeleton animation="wave" width="40%" sx={{ mt: 0.5 }} />
        <Skeleton animation="wave" width="50%" sx={{ mt: 0.5 }} />
      </CardContent>
    </Card>
  );
}

// Mirrors a ServiceTimeline event card: date line, title, works line.
export function TimelineEntrySkeleton() {
  return (
    <Card variant="outlined" sx={{ mb: 1, borderRadius: 2 }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Skeleton animation="wave" variant="rounded" width={96} height={24} />
          <Skeleton animation="wave" width="35%" />
        </Stack>
        <Skeleton animation="wave" width="70%" sx={{ mt: 1 }} />
        <Skeleton animation="wave" width="45%" sx={{ mt: 0.5 }} />
      </CardContent>
    </Card>
  );
}

// Mirrors the redesigned ReminderCard: category chip + title, anchor line, chips, actions.
export function ReminderCardSkeleton() {
  return (
    <Card variant="outlined" sx={{ mb: 1, borderRadius: 2 }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Skeleton animation="wave" variant="rounded" width={96} height={24} />
          <Skeleton animation="wave" width="40%" />
        </Stack>
        <Skeleton animation="wave" width="30%" height={28} sx={{ mt: 0.5 }} />
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
          <Skeleton animation="wave" variant="rounded" width={80} height={30} />
          <Skeleton animation="wave" variant="circular" width={30} height={30} />
        </Stack>
      </CardContent>
    </Card>
  );
}

// Mirrors a ChatPanel session row: icon, two text lines, trailing icons.
export function ChatSessionRowSkeleton() {
  return (
    <Stack direction="row" alignItems="center" spacing={1}
      sx={{ p: 1, borderRadius: 2, border: 1, borderColor: 'divider', mb: 1 }}>
      <Skeleton animation="wave" variant="circular" width={20} height={20} />
      <Box sx={{ flexGrow: 1 }}>
        <Skeleton animation="wave" width="60%" />
        <Skeleton animation="wave" width="30%" height={16} />
      </Box>
      <Skeleton animation="wave" variant="circular" width={28} height={28} />
    </Stack>
  );
}

// An assistant-shaped chat message: avatar + two text lines.
export function ChatBubbleSkeleton() {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', mb: 2 }}>
      <Skeleton animation="wave" variant="circular" width={30} height={30} />
      <Box sx={{ flexGrow: 1, pt: 0.25 }}>
        <Skeleton animation="wave" width="80%" />
        <Skeleton animation="wave" width="55%" />
      </Box>
    </Stack>
  );
}

// The Vehicle page hero: title, plate line, stat-tile row.
export function VehicleHeroSkeleton() {
  return (
    <Box sx={{ mb: 2 }}>
      <Skeleton animation="wave" width="45%" height={36} />
      <Skeleton animation="wave" width="30%" sx={{ mt: 0.5 }} />
      <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} animation="wave" variant="rounded" width={104} height={64} />
        ))}
      </Stack>
    </Box>
  );
}

// Admin dashboard stat tiles.
export function DashboardTilesSkeleton() {
  return (
    <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} animation="wave" variant="rounded" width={160} height={88} />
      ))}
    </Stack>
  );
}

// Admin user management row.
export function UserRowSkeleton() {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5}
      sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider', mb: 1 }}>
      <Skeleton animation="wave" variant="circular" width={36} height={36} />
      <Box sx={{ flexGrow: 1 }}>
        <Skeleton animation="wave" width="45%" />
        <Skeleton animation="wave" width="25%" height={16} />
      </Box>
      <Skeleton animation="wave" variant="circular" width={28} height={28} />
    </Stack>
  );
}
```

Read `VehicleCard.tsx`, `ServiceTimeline.tsx` (the per-event card), `ReminderCard.tsx`,
`ChatPanel.tsx`'s session row, `Vehicle.tsx`'s hero, `Dashboard.tsx`'s tiles, and
`UserManagement.tsx`'s user card first; adjust widths/heights where the reference code
above doesn't match reality. Mirroring reality wins over this listing.

- [ ] **Step 3: StatusView prop**

```tsx
import { type ReactNode } from 'react';
// ...existing imports

export function StatusView({
  state, message, skeleton,
}: { state: 'loading' | 'error'; message?: string; skeleton?: ReactNode }) {
  const { t } = useTranslation(['common']);
  if (state === 'loading') {
    // Content-shaped placeholder when the caller provides one; spinner fallback for
    // operations and not-yet-upgraded consumers.
    if (skeleton != null) return <>{skeleton}</>;
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  // ...error branch unchanged
```

- [ ] **Step 4: Gates + commit**

`pnpm turbo run build lint typecheck test` → green.

```bash
git add apps/web/src/components/ui/skeletons.tsx apps/web/src/components/ui/StatusView.tsx .interface-design/system.md
git commit -m "feat(web): content-shaped skeleton components"
```

---

### Task 2: Wire all 9 consumers

**Files:**
- Modify: `apps/web/src/routes/Garage.tsx`, `apps/web/src/routes/Vehicle.tsx`, `apps/web/src/components/ServiceTimeline.tsx`, `apps/web/src/components/RemindersSection.tsx`, `apps/web/src/components/ChatPanel.tsx`, `apps/web/src/routes/ChatConversation.tsx`, `apps/web/src/routes/PublicVehicle.tsx`, `apps/web/src/routes/admin/Dashboard.tsx`, `apps/web/src/routes/admin/UserManagement.tsx`

**Interfaces:**
- Consumes: every component from Task 1; `StatusView`'s `skeleton` prop.

- [ ] **Step 1: Wire each consumer**

Read each file's loading branch first, then swap. Exact per-site guidance:

1. **Garage** (`isLoading` branch): replace the current loading render with the real
   `<Grid container>` holding `{[0,1,2].map((i) => <Grid item xs={12} sm={6} md={4} key={i}><VehicleCardSkeleton /></Grid>)}` — same grid props as the loaded state so columns don't jump.
2. **Vehicle** initial `isLoading` (whole-page): `<AppShell><Container>` wrapping `<VehicleHeroSkeleton />` + 3× `<TimelineEntrySkeleton />` — match the loaded page's Container props.
3. **ServiceTimeline**: where it renders `StatusView state="loading"`, pass `skeleton={<>{[0,1,2].map((i) => <TimelineEntrySkeleton key={i} />)}</>}`.
4. **RemindersSection** `isLoading` branch: 3× `<ReminderCardSkeleton />`.
5. **ChatPanel** `sessions.isLoading`: 3× `<ChatSessionRowSkeleton />`.
6. **ChatConversation** `session.isLoading`: 3× `<ChatBubbleSkeleton />` (replaces the centered spinner in the message area; the send-pending "Thinking…" spinner STAYS).
7. **PublicVehicle**: its loading state gets `VehicleHeroSkeleton` + 3× `TimelineEntrySkeleton` (via its StatusView if it uses one — read the file).
8. **Dashboard**: loading → `<DashboardTilesSkeleton />` (keep any error branch as-is).
9. **UserManagement**: loading → 3× `<UserRowSkeleton />`.

Remove now-unused `CircularProgress` imports ONLY in files where no other use remains
(ChatConversation keeps it for RecordingBar/thinking; check each file).

- [ ] **Step 2: Verify no operation-spinner was converted**

`grep -rn "CircularProgress" apps/web/src --include="*.tsx"` — expect remaining hits ONLY in: `auth/index.tsx`, `auth/RequireAdmin.tsx`, `routes/Callback.tsx`, `components/chat/RecordingBar.tsx`, `components/ScanInvoiceDialog.tsx`, `components/ui/BatchUploadStatus.tsx`, `components/ui/StatusView.tsx` (fallback), `routes/ChatConversation.tsx` (thinking state). Paste the grep output into the report.

- [ ] **Step 3: Gates + commit**

`pnpm turbo run build lint typecheck test` → green.

```bash
git add apps/web/src/routes/Garage.tsx apps/web/src/routes/Vehicle.tsx apps/web/src/components/ServiceTimeline.tsx apps/web/src/components/RemindersSection.tsx apps/web/src/components/ChatPanel.tsx apps/web/src/routes/ChatConversation.tsx apps/web/src/routes/PublicVehicle.tsx apps/web/src/routes/admin/Dashboard.tsx apps/web/src/routes/admin/UserManagement.tsx
git commit -m "feat(web): skeleton loading across all content views"
```

---

### Task 3: Merge + deploy (web only)

- [ ] `pnpm turbo run build lint typecheck test` → 18/18.
- [ ] `git checkout main && git merge --no-ff feat/skeleton-loading -m "feat: skeleton loading states"`
- [ ] `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`
- [ ] User visual pass: throttle network (or fresh PWA open) → Garage, Vehicle, Reminders, chat list, chat history show shaped placeholders; content lands without layout jump; transcribing/scanning still show spinners.
