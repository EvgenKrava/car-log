# CarLog UI Redesign (Clean Modern SaaS) — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorming) → ready for implementation plan
**Builds on:** the deployed CarLog web app (Vite + React + MUI SPA)

## Goal

Replace CarLog's generic default-Material look with a distinctive, polished
"clean modern SaaS" design (Linear/Stripe-like): airy, rounded, one confident
accent, intentional light AND dark themes. Achieved via a **MUI + custom design
layer** — keep MUI for behavior (forms, dialogs, data, routing, auth), add a
design-token theme and bespoke visual components on top so the app stops reading
as default-MUI. Full in-app redesign of every screen/component we own.
Frontend-only; no behavior/logic changes.

## Locked Decisions

| Area | Decision |
|------|----------|
| Design source | Craft a distinctive UI in-house (no external paste); use `frontend-design` + `interface-design` skills |
| Foundation | MUI + custom design layer (keep MUI for behavior; bespoke visual components on top) |
| Personality | Clean modern SaaS — bright, airy, rounded, one confident accent, subtle shadows |
| Theme mode | Auto light + dark (keep existing `prefers-color-scheme` switch); both designed intentionally |
| Scope | Full in-app redesign: theme foundation + all owned screens/components |
| Build strategy | Approach A — design tokens + rebuilt MUI theme + shared primitives, then restyle screens |

## Mandatory tooling (per user global CLAUDE.md)

- Run **`interface-design`** BEFORE writing components; it must produce
  `.interface-design/system.md` stating audience, intent, signature element,
  and rejected defaults, and lock the palette/type/space choices.
- Use **`frontend-design`** for the component craft.
- These run inside implementation (the plan's first task), not during
  brainstorming.

## Layer 1 — Design system foundation

Lock the system into `.interface-design/system.md`:
- **Audience:** individual car owners keeping a personal maintenance history.
- **Intent:** calm, trustworthy, premium-but-simple.
- **Rejected defaults (explicit):** the current default-MUI blue `#1565c0`,
  flat/harsh-shadow cards, cramped dialogs, bare spinners, uppercase buttons.

Concrete tokens in a new `apps/web/src/theme/tokens.ts`:
- **Color:** move OFF `#1565c0`. One confident accent (candidate: an
  indigo/violet in the `#5B5BD6` family, OR a deep teal — the exact hue is
  locked in `system.md` during implementation), a full neutral gray scale for
  surfaces/text, and semantic success/error/warning.
  - Light: app bg near-white (`#F7F8FA`), cards white, hairline borders.
  - Dark: layered charcoals (bg `#0F1115`, card `#181B20`) — never pure black.
- **Typography:** Inter, self-hosted via `@fontsource/inter` (bundled, so the
  app-shell service worker precaches it — NO external font CDN). Type ramp:
  display / h1–h3 / body / caption; tightened heading letter-spacing.
- **Shape / space / elevation:** radius scale (~8/12/16), 8px spacing rhythm,
  soft layered shadows (replacing MUI's default harsher ones).

## Layer 2 — MUI theme rebuild (`apps/web/src/theme.ts`)

Rebuild `buildTheme(mode: 'light' | 'dark')` to consume the tokens:
- Full `palette` for both modes; `typography` (Inter + ramp);
  `shape.borderRadius`.
- **`components` default overrides** so every MUI element inherits the look with
  no per-usage styling — this is the primary lever:
  - `MuiButton`: `textTransform: none`, medium weight, rounded, refined hover.
  - `MuiCard` / `MuiPaper`: custom radius + soft shadow, no default divider.
  - `MuiTextField` / `MuiOutlinedInput`: softly-outlined, comfortable density.
  - `MuiDialog`: rounded, more padding.
  - `MuiAppBar`: flat, subtle bottom border instead of shadow.
  - `MuiFab`, `MuiChip`: themed to match.
- The existing `main.tsx` `prefers-color-scheme` → `buildTheme(...)` wiring is
  kept unchanged; only the theme's contents change.

## Layer 3 — Shared bespoke components (`apps/web/src/components/ui/`)

The custom design layer — small, focused, reused:
- `AppShell` — page frame: app bar slot + content container + safe bottom
  padding (clears FAB and InstallPrompt).
- `PageHeader` — title + optional back button + actions slot (Garage, Vehicle).
- `VehicleCard` — bespoke card (not raw `Card`): display name (nickname or
  make+model), year · mileage, fuel-type chip, subtle hover lift; navigable.
- `EmptyState` — icon + headline + subtext + CTA (Garage "Add your first car").
- `StatusView` — unified loading (skeletons, not bare spinner) and error/
  not-found states, used by Garage and Vehicle.

## Layer 4 — Screen restyles (behavior unchanged)

Rewire each screen to the theme + primitives; keep ALL existing hooks/logic
(`useCars`, `useCar`, `useCreateCar`, `useUpdateCar`, `useDeleteCar`, routing,
auth) exactly as-is.
- **Garage** — `AppShell` + `PageHeader`; responsive `VehicleCard` grid;
  `EmptyState`; `StatusView` skeletons; restyled FAB.
- **Vehicle** — `AppShell` + `PageHeader` (back + Edit/Delete); clean detail
  layout (grouped spec rows / definition list; fuel-type chip); `StatusView`
  for loading and not-found.
- **CarFormDialog / ConfirmDialog** — inherit themed dialog look; light polish
  (spacing, button hierarchy). No logic change (full-replace PUT etc. intact).
- **InstallPrompt** — inherits themed Paper; ALSO fix the prior review's Minor:
  the fixed bottom banner must not obscure the Garage FAB (offset the FAB when
  the banner is visible, or inset the banner — resolved via `AppShell`'s bottom
  padding + a banner/FAB stacking rule).
- **Callback** — themed centered loader.

## Layer 5 — Fonts, testing, verification

- **Fonts:** add `@fontsource/inter` (self-hosted; bundled into the build so the
  SW precaches it; no runtime CDN — consistent with the app-shell-only SW and
  its `woff2` glob).
- **Testing:** this is visual/theme work with no new branching logic → no new
  unit tests. Gates per task: `pnpm --filter @carlog/web typecheck` + `lint` +
  `build`. Existing suites stay green (`resolveInstallMode` 6, and api/domain/
  contracts unaffected since no behavior changes). Full repo gate
  `pnpm turbo run typecheck lint test` green.
- **Verification (definition of done):** web-only deploy via
  `scripts/deploy-web.sh`; live check that (1) light and dark both render
  intentionally and cohere across all screens, (2) the SW still precaches fonts
  and still does NOT cache the API (`grep -c execute-api dist/sw.js == 0`),
  (3) the Garage FAB is tappable even with the InstallPrompt banner shown,
  (4) Garage/Vehicle/dialog flows still work end-to-end (create/edit/delete).

## Scope Guard (YAGNI)

Out of scope: new features or screens, a manual theme toggle (auto-only stays),
replacing MUI, any dependency beyond `@fontsource/inter`, and any change to
API/domain/CDK. Behavior and logic are untouched — this is purely visual.

## Files (anticipated)

```
.interface-design/system.md                  CREATE  locked design system
apps/web/src/theme/tokens.ts                  CREATE  color/type/space/shadow tokens
apps/web/src/theme.ts                         MODIFY  rebuild buildTheme from tokens + component overrides
apps/web/src/components/ui/AppShell.tsx       CREATE
apps/web/src/components/ui/PageHeader.tsx     CREATE
apps/web/src/components/ui/VehicleCard.tsx    CREATE
apps/web/src/components/ui/EmptyState.tsx     CREATE
apps/web/src/components/ui/StatusView.tsx     CREATE
apps/web/src/routes/Garage.tsx                MODIFY  use shell/header/card/empty/status
apps/web/src/routes/Vehicle.tsx               MODIFY  use shell/header/status; detail layout
apps/web/src/routes/Callback.tsx              MODIFY  themed loader
apps/web/src/components/CarFormDialog.tsx     MODIFY  themed polish (no logic change)
apps/web/src/components/ConfirmDialog.tsx     MODIFY  themed polish
apps/web/src/components/InstallPrompt.tsx     MODIFY  themed + FAB-overlap fix
apps/web/src/main.tsx                         MODIFY  import Inter font (buildTheme wiring unchanged)
apps/web/package.json                         MODIFY  + @fontsource/inter
```
