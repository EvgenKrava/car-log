# UI Polish: Motion System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motion tokens + reduced-motion support, bottom sheets that slide up (the reported add-vehicle defect), staggered list enters app-wide, and a Reminders tab redesign (urgency groups, one primary action, dueness as the anchor).

**Architecture:** All web-only. Motion constants live in `theme/tokens.ts` and the design system doc; the sheet fix is one breakpoint-aware `TransitionComponent` in `Modal.tsx` (every dialog inherits); list enters are a CSS-keyframe `<Reveal>` wrapper; the Reminders redesign builds on a new pure `groupReminders` helper over existing `reminderStatus`.

**Tech Stack:** React + TS (strict), MUI transitions (`Slide`/`Grow`/`Zoom`/`Collapse`), CSS keyframes, Vitest. **No new dependencies.**

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-05-ui-polish-motion-design.md` is authoritative.
- Durations `fast: 150` / `base: 220` / `slow: 320` (ms); easings `standard: 'cubic-bezier(0.2, 0, 0, 1)'`, `exit: 'cubic-bezier(0.4, 0, 1, 1)'`.
- **Animate only `transform` and `opacity`** (`Collapse` for list removal is the sanctioned exception). Everything respects `prefers-reduced-motion: reduce`. Animations mark user-initiated appearance — never data refetches.
- Strict TS, never `any`. MUI only, sx-prop style. No new dependencies (no framer-motion).
- This pass touches `apps/web` ONLY — no api/domain/contracts/infrastructure changes.
- i18n: new keys in BOTH en and uk (`reminders` namespace), key sets symmetric.
- No TODO/stubs. Trailing newline at EOF. Conventional commits, NO trailers.
- Gates per task: `pnpm turbo run build lint typecheck test` green.
- Branch: `feat/ui-polish-motion`.

---

## File Structure

- `apps/web/src/theme/tokens.ts` (modify) — `motion` block.
- `apps/web/src/theme.ts` (modify) — reduced-motion clamp via `MuiCssBaseline`.
- `.interface-design/system.md` (modify) — Motion locked section.
- `apps/web/src/components/ui/Modal.tsx` (modify) — breakpoint-aware transitions.
- `apps/web/src/components/ui/useBottomSheetDismiss.ts` (modify) — clear inline transform on dismiss so the Slide exit owns the travel.
- `apps/web/src/components/ui/Reveal.tsx` (create) — staggered enter wrapper.
- `apps/web/src/routes/Garage.tsx`, `components/ServiceTimeline.tsx`, `routes/ChatConversation.tsx`, `routes/Vehicle.tsx` (modify) — apply Reveal / tab fade / FAB polish.
- `apps/web/src/lib/reminder-view.ts` (modify) — `groupReminders`; `lib/reminder-view.test.ts` (modify) — tests.
- `apps/web/src/components/RemindersSection.tsx`, `components/ReminderCard.tsx` (modify) — redesign.
- `apps/web/src/i18n/locales/{en,uk}/reminders.json` (modify) — group headers + empty-state keys.

---

### Task 1: Motion tokens, reduced-motion clamp, Modal slide-up

**Files:**
- Modify: `apps/web/src/theme/tokens.ts`
- Modify: `apps/web/src/theme.ts`
- Modify: `.interface-design/system.md`
- Modify: `apps/web/src/components/ui/Modal.tsx`
- Modify: `apps/web/src/components/ui/useBottomSheetDismiss.ts`

**Interfaces:**
- Consumes: existing `tokens`, `Modal`, `useBottomSheetDismiss`.
- Produces: `tokens.motion.duration.{fast,base,slow}: number`, `tokens.motion.easing.{standard,exit}: string`. Later tasks import `tokens` from `'../../theme/tokens'` (adjust depth per file).

- [ ] **Step 1: Add the motion tokens**

In `apps/web/src/theme/tokens.ts`, after the `shadow` block:

```ts
  // Motion: quiet confidence — things arrive decelerating, leave accelerating.
  // Animate only transform/opacity; user-initiated appearance only (never refetches).
  motion: {
    duration: { fast: 150, base: 220, slow: 320 }, // ms
    easing: {
      standard: 'cubic-bezier(0.2, 0, 0, 1)', // decelerate — arriving
      exit: 'cubic-bezier(0.4, 0, 1, 1)',     // accelerate — leaving
    },
  },
```

- [ ] **Step 2: Global reduced-motion clamp**

In `apps/web/src/theme.ts`, add to the `components` map (read the file first; place next to `MuiDialog`):

```ts
      MuiCssBaseline: {
        styleOverrides: `
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0.01ms !important;
            }
          }
        `,
      },
```

If a `MuiCssBaseline` entry already exists, merge into it. Verify `<CssBaseline />` is
rendered at the app root (`main.tsx` / theme provider) — it is; do not add a second one.

- [ ] **Step 3: Document the Motion section**

Append to `.interface-design/system.md` under Locked Decisions:

```markdown
### Motion
- **Durations**: 150ms (fast — hovers, fades), 220ms (base — sheets, dialogs, list items), 320ms (slow — page-level)
- **Easings**: `cubic-bezier(0.2, 0, 0, 1)` standard (decelerate — things arriving), `cubic-bezier(0.4, 0, 1, 1)` exit (accelerate — things leaving)
- **Only `transform` and `opacity` animate** (Collapse for list removal is the sanctioned exception)
- **Motion marks user-initiated appearance** — opening, adding, sending. Data refetches never animate.
- **`prefers-reduced-motion: reduce` disables everything** (global clamp in MuiCssBaseline)
- Phone bottom sheets slide up from the bottom edge; desktop dialogs use a quick Grow. Never a bare Fade for a sheet.
```

- [ ] **Step 4: Breakpoint-aware Modal transition**

In `apps/web/src/components/ui/Modal.tsx`:

Add imports:

```tsx
import { forwardRef, type ReactElement, type Ref } from 'react';
import { Grow, Slide, useMediaQuery, useTheme } from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import { tokens } from '../../theme/tokens';
```

Above the `Modal` component, define the transitions once (module scope — a
`TransitionComponent` defined inside render remounts the dialog every render):

```tsx
// Phones: the sheet slides up from the bottom edge (and exits downward), completing the
// bottom-sheet metaphor the MuiDialog theme override establishes visually. Desktop: a
// quick Grow — calmer than the stock Fade. `plain` lightboxes keep MUI's default Fade.
const SheetTransition = forwardRef(function SheetTransition(
  props: TransitionProps & { children: ReactElement },
  ref: Ref<unknown>,
) {
  return (
    <Slide
      direction="up"
      ref={ref}
      timeout={{ enter: tokens.motion.duration.base, exit: tokens.motion.duration.fast }}
      easing={{ enter: tokens.motion.easing.standard, exit: tokens.motion.easing.exit }}
      {...props}
    />
  );
});

const DesktopTransition = forwardRef(function DesktopTransition(
  props: TransitionProps & { children: ReactElement },
  ref: Ref<unknown>,
) {
  return <Grow ref={ref} timeout={tokens.motion.duration.fast} {...props} />;
});
```

Inside `Modal`, pick per breakpoint (before the `return`):

```tsx
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  // `plain` (lightbox) keeps the default Fade; a slide-up would fight its gestures.
  const TransitionComponent = plain ? undefined : isPhone ? SheetTransition : DesktopTransition;
```

And on the `<Dialog>`, before the `{...dialogProps}` spread so a caller's explicit
override still wins:

```tsx
      {...(TransitionComponent ? { TransitionComponent } : {})}
      {...dialogProps}
```

- [ ] **Step 5: Let the Slide exit own the swipe-dismiss travel**

In `apps/web/src/components/ui/useBottomSheetDismiss.ts`, in `onTouchEnd`, the
dismiss branch currently sets `node.style.transform = 'translateY(100%)'` and closes.
With the Slide exit now animating the paper's transform, the inline value would fight
it. Replace the dismiss branch:

```ts
    if (delta.current > DISMISS_THRESHOLD_PX && onDismiss) {
      // Hand the remaining travel to the Dialog's Slide exit: clear our inline
      // transform/transition so the transition component owns the paper again.
      node.style.transition = '';
      node.style.transform = '';
      onDismiss();
    } else {
```

(The spring-back branch stays exactly as is.)

- [ ] **Step 6: Gates**

Run: `pnpm turbo run build lint typecheck test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/theme/tokens.ts apps/web/src/theme.ts .interface-design/system.md apps/web/src/components/ui/Modal.tsx apps/web/src/components/ui/useBottomSheetDismiss.ts
git commit -m "feat(web): motion tokens, reduced-motion clamp, bottom-sheet slide-up"
```

---

### Task 2: Reveal wrapper + app-wide application

**Files:**
- Create: `apps/web/src/components/ui/Reveal.tsx`
- Modify: `apps/web/src/routes/Garage.tsx`
- Modify: `apps/web/src/components/ServiceTimeline.tsx`
- Modify: `apps/web/src/routes/ChatConversation.tsx`
- Modify: `apps/web/src/routes/Vehicle.tsx`

**Interfaces:**
- Consumes: `tokens.motion` (Task 1).
- Produces: `<Reveal index={number}>{children}</Reveal>` — staggered first-mount enter.

- [ ] **Step 1: The Reveal component**

Create `apps/web/src/components/ui/Reveal.tsx`:

```tsx
import { useRef, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { tokens } from '../../theme/tokens';

// Marks user-initiated appearance of a list item: opacity 0→1 + translateY(8px)→0,
// staggered by index (capped so long lists don't crawl). Runs ONCE per mount of the
// wrapper — a TanStack refetch re-rendering the list must not re-trigger it, which is
// why the animation is keyed to mount (useRef) and not to data identity.
const STAGGER_MS = 30;
const STAGGER_CAP = 9; // items beyond the 10th appear together

export function Reveal({ index = 0, children }: { index?: number; children: ReactNode }) {
  // Freeze the delay at first mount; re-renders keep the same node, so the CSS
  // animation (which runs once per node) never restarts.
  const delay = useRef(Math.min(index, STAGGER_CAP) * STAGGER_MS);
  return (
    <Box
      sx={{
        '@keyframes carlogReveal': {
          from: { opacity: 0, transform: 'translateY(8px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        opacity: 0,
        animation: `carlogReveal ${tokens.motion.duration.base}ms ${tokens.motion.easing.standard} ${delay.current}ms forwards`,
      }}
    >
      {children}
    </Box>
  );
}
```

Note `opacity: 0` + `forwards`: the item is invisible until its delayed animation runs,
then stays visible. The reduced-motion clamp (Task 1) collapses the animation to ~0ms,
so items appear instantly there.

- [ ] **Step 2: Apply to the Garage grid**

In `apps/web/src/routes/Garage.tsx`, wrap the card inside each Grid item:

```tsx
                <Grid item xs={12} sm={6} md={4} key={car.id}>
                  <Reveal index={i}>
                    <VehicleCard car={car} onClick={() => navigate(`/cars/${car.id}`)} />
                  </Reveal>
                </Grid>
```

(The `.map((car) => ...)` gains the index parameter: `.map((car, i) => ...)`.)

Also in this file: the FAB gets a mount animation and a press state, and the hardcoded
aria-label becomes i18n:

```tsx
      <Zoom in timeout={tokens.motion.duration.base}>
        <Fab color="primary" onClick={() => setOpen(true)} aria-label={t('garage:addCar')}
          sx={{ position: 'fixed', bottom: 24, right: 24,
            transition: `transform ${tokens.motion.duration.fast}ms ${tokens.motion.easing.standard}`,
            '&:active': { transform: 'scale(0.96)' } }}>
          <AddIcon />
        </Fab>
      </Zoom>
```

Imports: `Zoom` from `@mui/material`, `Reveal`, `tokens`.

- [ ] **Step 3: Apply to the timeline and reminders list**

`apps/web/src/components/ServiceTimeline.tsx`: read the file; wrap each rendered event
entry (the per-event card/row inside its `.map`) in `<Reveal index={i}>`, threading the
map index. Do not wrap headers/dividers — only the event items.

The reminders list is Task 3's file (`RemindersSection`), where Reveal is applied as
part of the redesign — skip it here to avoid cross-task edits.

- [ ] **Step 4: Chat messages + tab fade + Vehicle FAB**

`apps/web/src/routes/ChatConversation.tsx`: wrap each `<ChatBubble>` in the messages map
(and the optimistic pending bubble) in `<Reveal>`; for the messages map use
`<Reveal index={Math.max(0, i - (messages.length - 10))}>` so on first load only the
LAST ~10 messages stagger (older ones get index ≤ 0 → no delay) and a newly appended
message (always last) animates with no delay.

`apps/web/src/routes/Vehicle.tsx`:
- Tab switch fade: wrap the tab-content container in a keyed `<Fade>`:
  find where the active tab's panel renders and wrap with
  `<Fade in key={tab} timeout={tokens.motion.duration.fast}><Box>{...existing panel...}</Box></Fade>`.
  Read the surrounding structure first; the key on the Fade is what restarts it per switch.
- The desktop FAB (`Vehicle.tsx:464`) gets the same Zoom + press treatment as Garage's
  (keep its existing `display` and aria-label logic).

- [ ] **Step 5: Gates**

Run: `pnpm turbo run build lint typecheck test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/Reveal.tsx apps/web/src/routes/Garage.tsx apps/web/src/components/ServiceTimeline.tsx apps/web/src/routes/ChatConversation.tsx apps/web/src/routes/Vehicle.tsx
git commit -m "feat(web): staggered list enters, tab fade, FAB polish"
```

---

### Task 3: Reminders tab redesign

**Files:**
- Modify: `apps/web/src/lib/reminder-view.ts`
- Modify: `apps/web/src/lib/reminder-view.test.ts`
- Modify: `apps/web/src/components/RemindersSection.tsx`
- Modify: `apps/web/src/components/ReminderCard.tsx`
- Modify: `apps/web/src/i18n/locales/en/reminders.json`, `apps/web/src/i18n/locales/uk/reminders.json`

**Interfaces:**
- Consumes: `reminderStatus`, `sortReminders`, `todayISO`, `daysUntil` (existing); `Reveal`, `tokens.motion` (Tasks 1–2); `EmptyState` (existing).
- Produces: `groupReminders(reminders: Reminder[], carMileage: number, today: string): { overdue: Reminder[]; dueSoon: Reminder[]; later: Reminder[] }`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/reminder-view.test.ts` (read it first; reuse its fixture
helper if one exists, else this minimal builder):

```ts
describe('groupReminders', () => {
  const r = (over: Partial<Reminder> & { id: string }): Reminder => ({
    carId: 'c1', ownerId: 'o1', title: over.id, category: 'other',
    notes: undefined, dueDate: undefined, dueMileage: undefined,
    repeatMonths: undefined, repeatKm: undefined,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
  const today = '2026-08-05';
  const mileage = 100_000;

  it('splits by status and keeps urgency order inside each group', () => {
    const groups = groupReminders([
      r({ id: 'later', dueDate: '2026-12-01' }),
      r({ id: 'overdue-km', dueMileage: 99_000 }),
      r({ id: 'soon', dueDate: '2026-08-20' }),          // inside 30-day lead
      r({ id: 'overdue-date', dueDate: '2026-08-01' }),
    ], mileage, today);
    expect(groups.overdue.map((x) => x.id)).toEqual(['overdue-date', 'overdue-km']);
    expect(groups.dueSoon.map((x) => x.id)).toEqual(['soon']);
    expect(groups.later.map((x) => x.id)).toEqual(['later']);
  });

  it('due today is overdue; exactly at the km lead threshold is due_soon', () => {
    const groups = groupReminders([
      r({ id: 'today', dueDate: today }),
      r({ id: 'at-lead', dueMileage: mileage + 1000 }), // REMINDER_LEAD_KM boundary
    ], mileage, today);
    expect(groups.overdue.map((x) => x.id)).toEqual(['today']);
    expect(groups.dueSoon.map((x) => x.id)).toEqual(['at-lead']);
  });

  it('returns three empty arrays for no reminders', () => {
    expect(groupReminders([], mileage, today)).toEqual({ overdue: [], dueSoon: [], later: [] });
  });
});
```

Add `groupReminders` to the file's import from `./reminder-view`, and `Reminder` type
from `@carlog/contracts` if not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @carlog/web test src/lib/reminder-view.test.ts`
Expected: FAIL — `groupReminders` is not exported.

- [ ] **Step 3: Implement**

Append to `apps/web/src/lib/reminder-view.ts`:

```ts
export type ReminderGroups = { overdue: Reminder[]; dueSoon: Reminder[]; later: Reminder[] };

// The Reminders tab renders urgency sections; grouping reuses the sorted order so each
// section is internally sorted (nearest first) without a second comparator.
export function groupReminders(reminders: Reminder[], carMileage: number, today: string): ReminderGroups {
  const groups: ReminderGroups = { overdue: [], dueSoon: [], later: [] };
  for (const reminder of sortReminders(reminders, carMileage, today)) {
    const status = reminderStatus(reminder, carMileage, today);
    if (status === 'overdue') groups.overdue.push(reminder);
    else if (status === 'due_soon') groups.dueSoon.push(reminder);
    else groups.later.push(reminder);
  }
  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @carlog/web test src/lib/reminder-view.test.ts`
Expected: PASS.

- [ ] **Step 5: i18n keys**

`apps/web/src/i18n/locales/en/reminders.json` — add:

```json
  "groupOverdue": "Overdue",
  "groupDueSoon": "Due soon",
  "groupLater": "Later",
  "emptyTitle": "No reminders yet",
  "emptyBody": "Get a nudge before service is due — by date, mileage, or both."
```

`apps/web/src/i18n/locales/uk/reminders.json` — add:

```json
  "groupOverdue": "Прострочені",
  "groupDueSoon": "Незабаром",
  "groupLater": "Пізніше",
  "emptyTitle": "Поки немає нагадувань",
  "emptyBody": "Отримуйте нагадування до настання обслуговування — за датою, пробігом або обома."
```

- [ ] **Step 6: RemindersSection — groups, empty state, animated removal**

Rework `apps/web/src/components/RemindersSection.tsx` (read it fully first; keep its
dialogs/mutations wiring intact):

- Replace the flat `sorted.map(...)` with three sections from
  `groupReminders(reminders ?? [], car.mileage, todayISO())`:

```tsx
  const groups = groupReminders(reminders ?? [], car.mileage, todayISO());
  const sections = [
    { key: 'overdue', title: t('reminders:groupOverdue'), items: groups.overdue },
    { key: 'dueSoon', title: t('reminders:groupDueSoon'), items: groups.dueSoon },
    { key: 'later', title: t('reminders:groupLater'), items: groups.later },
  ].filter((s) => s.items.length > 0);
```

- Render, with `Reveal` staggering across the whole tab (thread a running index) and
  `Collapse` for animated removal:

```tsx
      {sections.map((section) => (
        <Box key={section.key} sx={{ mb: 2 }}>
          <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            {section.title}
          </Typography>
          {section.items.map((reminder) => (
            <Collapse key={reminder.id} in={!removing.has(reminder.id)}
              timeout={tokens.motion.duration.base} unmountOnExit>
              <Reveal index={runningIndex(reminder.id)}>
                <ReminderCard ... />
              </Reveal>
            </Collapse>
          ))}
        </Box>
      ))}
```

  Implementation of removal: keep a `const [removing, setRemoving] = useState<Set<string>>(new Set())`;
  the existing complete/delete handlers first `setRemoving(prev => new Set(prev).add(id))`,
  then fire the mutation after `tokens.motion.duration.base` ms (a `setTimeout`) so the
  Collapse plays before the refetch reflows the list; clear the id from `removing` in the
  mutation's `onSettled`. `runningIndex` is a simple counter closure over the render pass
  (`let idx = 0;` before the sections map, `idx++` per card) — compute it inline, not
  as state.

- Empty state (replaces the bare text):

```tsx
      ) : !sections.length ? (
        <EmptyState
          title={t('reminders:emptyTitle')}
          description={t('reminders:emptyBody')}
          action={<Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('reminders:add')}</Button>}
        />
      ) : (
```

  where `openCreate` is whatever the section already uses to open the create dialog
  (read the file; reuse the existing handler name). `reminders:add` already exists.

- [ ] **Step 7: ReminderCard — accent border, anchor line, overflow menu**

Rework `apps/web/src/components/ReminderCard.tsx`:

- Compute once at the top (status already computed):

```tsx
  const accent = status === 'overdue' ? 'error.main' : status === 'due_soon' ? 'warning.main' : undefined;
```

- Card gains the accent: `sx={{ mb: 1, borderRadius: 2, ...(accent ? { borderLeft: 3, borderLeftColor: accent } : {}) }}`.
- **Anchor line:** the relative dueness (the `rel` part of today's `dateLabel`, and/or the
  km-remaining part of `kmLabel`) moves into a prominent line directly under the title:

```tsx
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 0.5, color: accent ?? 'text.primary' }}>
          {anchorText}
        </Typography>
```

  `anchorText`: prefer the NEARER signal — if both date and km exist, show the one whose
  status drives the chip color today (overdue beats due_soon beats ok; on a tie prefer
  date); build it from the existing `rel` / `dueInKm`/`overdueKm` strings. Keep the
  absolute date and odometer target as the existing small chips (now `variant="outlined"`,
  default color — the anchor carries the status color instead).
- **Actions:** "Done" becomes `variant="contained" size="small"`; Edit and Delete move
  into an overflow menu — small `IconButton` with `MoreVertIcon` + `Menu` with two
  `MenuItem`s (pattern: the car-actions menu in `Vehicle.tsx` — read it and mirror the
  ListItemIcon/ListItemText structure). Menu state is component-local.

- [ ] **Step 8: Gates**

Run: `pnpm turbo run build lint typecheck test`
Expected: green (incl. the new `groupReminders` tests).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/reminder-view.ts apps/web/src/lib/reminder-view.test.ts apps/web/src/components/RemindersSection.tsx apps/web/src/components/ReminderCard.tsx apps/web/src/i18n/locales/en/reminders.json apps/web/src/i18n/locales/uk/reminders.json
git commit -m "feat(web): reminders tab redesign — urgency groups, anchor dueness, one primary action"
```

---

### Task 4: Merge, deploy, verify

**Files:** none.

- [ ] **Step 1: All gates**

Run: `pnpm turbo run build lint typecheck test`
Expected: fully green.

- [ ] **Step 2: Merge and deploy web**

```bash
git checkout main && git merge --no-ff feat/ui-polish-motion -m "feat: motion system, sheet slide-up, reminders redesign"
AWS_PROFILE=yevhenii ./scripts/deploy-web.sh
```

- [ ] **Step 3: Manual verification (user)**

1. Phone: add-vehicle sheet SLIDES UP from the bottom; swipe-dismiss exits downward.
2. Garage cards and timeline entries stagger in on first open; switching tabs fades;
   pull-to-refresh / background refetch does NOT re-animate lists.
3. Reminders tab: urgency sections, accent borders, big dueness line, ⋮ menu, contained
   Done; completing a reminder collapses it out.
4. iOS Settings → Accessibility → Motion → Reduce Motion: all animations effectively off.

---

## Notes for the implementer

- `TransitionComponent` must be defined at module scope — defining it inside render
  remounts the Dialog subtree on every render (focus loss, animation restarts).
- `Reveal` must not re-trigger on refetch: the guard is CSS `animation` running once per
  DOM node + `useRef` freezing the delay. Do not key Reveal off data.
- The reminders list keeps ALL existing mutation/dialog behavior — this is a re-skin plus
  grouping, not a logic change. `reminder-view.ts` mirrors domain logic; do not touch
  `reminderStatus`/`sortReminders` internals.