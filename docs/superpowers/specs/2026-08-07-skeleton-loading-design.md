# Skeleton Loading States

**Date:** 2026-08-07
**Status:** Approved

## Goal

Replace content-shaped loading spinners with skeleton placeholders app-wide, closing the
design system's existing "no bare spinners" gap. Spinners remain ONLY for genuine
operations.

## Principle (added to `.interface-design/system.md` as a locked decision)

- **Skeletons for content with a knowable shape** — lists, cards, heroes, stat tiles.
  The wait means "your data is on its way"; the placeholder mirrors the layout so content
  appears without shift.
- **Spinners for operations** — transcribing, scanning, uploading, auth redirects. The
  wait means "something is working"; there is no layout to mimic.
- Skeletons use MUI `Skeleton` (`animation="wave"`), sized to match the real component;
  the existing `prefers-reduced-motion` clamp silences the wave.
- 3 placeholder items per list skeleton.

## Changes

### New: `apps/web/src/components/ui/skeletons.tsx`

One file of small presentation-only components, each mirroring its real counterpart's
dimensions and internal structure:

- `VehicleCardSkeleton` — mirrors `VehicleCard` (title line, subtitle, stat row).
- `TimelineEntrySkeleton` — mirrors a `ServiceTimeline` event card.
- `ReminderCardSkeleton` — mirrors the redesigned `ReminderCard` (chip, title, anchor line, actions row).
- `ChatSessionRowSkeleton` — mirrors a `ChatPanel` session row.
- `ChatBubbleSkeleton` — an assistant-shaped message row (avatar circle + 2 text lines).
- `VehicleHeroSkeleton` — the Vehicle page hero (title + plate + stat tiles).
- `StatTileSkeleton` / `DashboardTilesSkeleton` — admin dashboard tiles.
- `UserRowSkeleton` — admin user management row.

Grid/list wrappers repeat their item 3×.

### Modified: `StatusView`

`state: 'loading'` accepts an optional `skeleton?: ReactNode`; when provided it renders
that instead of the centered `CircularProgress`. No prop → current spinner (graceful
default for any consumer not upgraded). The `error` branch is unchanged.

### Consumers upgraded to skeletons

| Site | Skeleton |
|---|---|
| Garage grid (`Garage.tsx`) | 3× `VehicleCardSkeleton` inside the real Grid |
| Vehicle page initial load (`Vehicle.tsx`) | `VehicleHeroSkeleton` + 3× `TimelineEntrySkeleton` |
| Service timeline (`ServiceTimeline.tsx` via StatusView) | 3× `TimelineEntrySkeleton` |
| Reminders tab (`RemindersSection.tsx`) | 3× `ReminderCardSkeleton` |
| Chat session list (`ChatPanel.tsx`) | 3× `ChatSessionRowSkeleton` |
| Chat history load (`ChatConversation.tsx`) | 3× `ChatBubbleSkeleton` |
| Public vehicle page (`PublicVehicle.tsx`) | `VehicleHeroSkeleton` + timeline skeletons |
| Admin dashboard (`Dashboard.tsx`) | `DashboardTilesSkeleton` |
| Admin users (`UserManagement.tsx`) | 3× `UserRowSkeleton` |

### Deliberately kept as spinners (operations, not content)

- Auth gates: `RequireAuth`/`RequireAdmin` full-screen loading, `Callback.tsx` (redirect
  in progress).
- `RecordingBar` transcribing state.
- `ScanInvoiceDialog` scanning, `BatchUploadStatus`, import-job progress.
- Send-message pending ("Thinking…") in the chat — an operation with its own copy.
- Button-level busy states throughout.

### Rules

- Skeletons appear on `isLoading` (initial fetch) ONLY — never on background refetches
  (TanStack keeps stale data rendered; do not branch on `isFetching`).
- No layout shift: skeleton dimensions must match the loaded state closely enough that
  the swap doesn't move surrounding content.
- No new dependencies.

## Testing

Presentation-only — gates (`build lint typecheck test`) plus the user's visual pass
(each upgraded screen on throttled network). No unit tests for markup.

## Out of scope

- Suspense/streaming refactors; TanStack `placeholderData`.
- Progressive image loading.
- Any backend change.
