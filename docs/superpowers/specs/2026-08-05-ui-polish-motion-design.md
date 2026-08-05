# UI Polish: Motion System, Sheet Animation, Reminders Tab

**Date:** 2026-08-05
**Status:** Approved

## Goal

Three related UI/UX improvements, web-only:

1. A **motion system** — locked durations/easings in the design system and theme tokens,
   applied app-wide (list enters, tab switches, FABs, chat messages).
2. **Bottom-sheet slide-up animation** — the user-reported defect: dialogs that render as
   bottom sheets on phones currently use MUI's default Fade, so the add-vehicle sheet (and
   every other sheet) *materializes in place* instead of sliding up from the bottom edge.
3. A **Reminders tab redesign** — urgency grouping, one primary action per card, the due
   distance as the visual anchor, a real empty state.

## Non-negotiable context

- Design system: `.interface-design/system.md` — calm/trustworthy/premium-but-simple,
  soft indigo `#5B5BD6`, subtle elevation. Motion must read as quiet confidence, not flash.
- All dialogs flow through ONE component: `apps/web/src/components/ui/Modal.tsx`. The
  phone bottom-sheet treatment (anchor, drag handle, actions-to-top) lives in the
  `MuiDialog` theme override (`apps/web/src/theme.ts:57-110`); `useBottomSheetDismiss`
  provides swipe-to-dismiss by translating the paper during drag.
- Design tokens: `apps/web/src/theme/tokens.ts`.
- Reminders UI: `ReminderCard.tsx`, `RemindersSection.tsx`; pure view logic in
  `apps/web/src/lib/reminder-view.ts` (`reminderStatus`, `sortReminders`, `daysUntil`) —
  mirrored from domain; keep the mirror in sync note intact.
- FABs: `Garage.tsx:48` (fixed bottom-right; also has a hardcoded English
  `aria-label="Add car"` — fix to i18n in passing) and `Vehicle.tsx:464` (desktop-only).
- **No new dependencies.** MUI transitions (`Slide`, `Grow`, `Collapse`, `Fade`) + CSS
  keyframes only. No framer-motion.

## 1. Motion system

### Tokens (`theme/tokens.ts`)

```ts
motion: {
  duration: { fast: 150, base: 220, slow: 320 },     // ms
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',           // decelerate — things arriving
    exit: 'cubic-bezier(0.4, 0, 1, 1)',               // accelerate — things leaving
  },
},
```

### Design-system addendum (`.interface-design/system.md`, new "Motion" locked section)

- Durations/easings as above, with intent notes.
- **Animate only `transform` and `opacity`** — never width/height/top/left (layout thrash);
  `Collapse` for list-item removal is the sanctioned exception.
- Motion marks **user-initiated appearance** (opening, adding, sending). Data refetches and
  background updates never animate — a TanStack Query refetch must not make lists shimmer.
- Everything respects `prefers-reduced-motion: reduce`: one global clamp in the theme
  (`@media (prefers-reduced-motion: reduce)` → `animation-duration: 0.01ms !important;
  transition-duration: 0.01ms !important` on the animated selectors, applied via
  `MuiCssBaseline` styleOverrides).

## 2. Bottom-sheet slide-up

**Defect:** `Modal` inherits MUI Dialog's default `Fade`. On phones the sheet is visually a
bottom sheet but *appears/disappears in place* — the metaphor is broken. (This is the
reported add-vehicle button problem: `CarFormDialog` opens via this path.)

**Fix, in `Modal.tsx` only:**

- Breakpoint-aware transition: below `sm` (and when not `plain`/`carlog-no-sheet`),
  `TransitionComponent` = `Slide` with `direction="up"`, duration `motion.base` in,
  `motion.fast` out, easings standard/exit. At `sm` and up: `Grow` at `motion.fast`
  (subtle scale+fade — calmer than the stock Fade, consistent with the system).
- Use MUI's `useMediaQuery(theme.breakpoints.down('sm'))` to pick the component; pass via
  `dialogProps.TransitionComponent` merge so the existing `dialogProps` escape hatch still
  wins if a caller overrides.
- The `plain` (lightbox) variant keeps `Fade` — a slide-up lightbox fights its gestures.
- Swipe-to-dismiss: `useBottomSheetDismiss` already translates the paper during drag; on
  release-past-threshold it calls `onClose`, and the Slide exit now animates the remaining
  travel downward (instead of today's fade-in-place). Verify the hook's inline transform
  doesn't fight the Slide exit (clear the drag transform when triggering close).

Every dialog inherits this: car form, event form, reminder form/complete, chat rename,
delete confirms, password change, share, add-record sheet, scan/import.

## 3. App-wide animation application

- **`<Reveal index={n}>`** (`apps/web/src/components/ui/Reveal.tsx`): CSS-keyframe enter —
  opacity 0→1 + translateY(8px)→0, `motion.base`, `standard` easing, stagger
  `index * 30ms` capped at index 9 (items beyond 10 appear together). Applied on FIRST
  mount of a list only (component-local `useRef` guard so re-renders/refetches don't
  re-trigger). Used by: Garage vehicle grid, ServiceTimeline entries, Reminders list,
  chat messages (including the optimistic pending bubble).
- **Vehicle tab switch:** content container gets a keyed fade-in (`motion.fast`) on tab
  change. No horizontal slide (fights swipe gestures).
- **FABs (Garage + Vehicle):** MUI `Zoom` on mount (`motion.base`); `&:active` scale 0.96
  with `motion.fast` transition. Fix Garage FAB `aria-label` to `t('garage:addCar')`.
- **Reminder completion:** the card wraps in `Collapse` — completing/deleting animates out
  (`motion.base`, exit easing) before the list reflows.

## 4. Reminders tab redesign

Keep `reminder-view.ts` logic; add one pure helper `groupReminders(reminders, mileage,
today): { overdue: Reminder[]; dueSoon: Reminder[]; later: Reminder[] }` (unit-tested,
built on the existing `reminderStatus` + `sortReminders`).

**`RemindersSection`:**
- Three groups with small section headers (i18n: `reminders:groupOverdue`,
  `reminders:groupDueSoon`, `reminders:groupLater`); a group with no items renders nothing.
- Empty state: the app's `EmptyState` component with a CTA button opening the reminder
  form (replaces the bare text line).

**`ReminderCard`:**
- Overdue cards: 3px left accent border in `error.main`; due-soon: `warning.main`; later:
  no accent.
- **Visual anchor:** the relative dueness ("за 5 днів" / "500 км тому") moves out of the
  small chip into a prominent `subtitle1`-weight line under the title, colored by status.
  Absolute date / odometer target stay as small secondary chips.
- **One primary action:** "Done" becomes a small `variant="contained"` button (indigo);
  Edit + Delete collapse into a `⋮` `IconButton` + `Menu` (pattern: the Vehicle page's
  car-actions menu). i18n keys already exist for all three actions.
- Category chip and repeat chip unchanged.

## Testing

- `groupReminders` unit tests (boundaries: due today = overdue, exactly at lead threshold).
- Gates: `pnpm turbo run build lint typecheck test`.
- No browser harness: manual verification checklist — sheet slides up on phone (add
  vehicle, add event, reminder form), swipe-dismiss exits downward, reduced-motion
  (iOS Settings → Accessibility → Motion) kills animations, lists stagger on first
  mount but NOT on refetch, reminder complete collapses out, tab switch fades.

## Out of scope

- SEO / public landing page (deferred — next candidate feature, own spec).
- Push notifications; reminder data-model changes; Statistics.
- Any backend/API/CDK change (this pass is `apps/web` only).
- New animation dependencies.

## Decisions taken (confirmed 2026-08-05)

- All three scopes ship together (sheet animation, motion system + app-wide pass,
  reminders redesign).
- SEO deferred to its own feature.
- The add-vehicle problem = missing sheet slide-up (confirmed "modal animation does not
  meet requirements").