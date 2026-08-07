# CarLog Design System

## Audience
Individual car owners keeping a personal maintenance history.

## Intent
Calm, trustworthy, premium-but-simple. The interface should feel reliable and professional without being complex or overwhelming. Think personal finance tracker or health journal — organized, accessible, reassuring.

## Signature Element
Soft indigo accent (#5B5BD6) paired with generous whitespace, subtle shadows, and rounded corners. The design avoids aggressive color saturation in favor of quiet confidence.

## Rejected Defaults
- **Default Material UI blue** (#1565c0) — too corporate, too saturated
- **Harsh shadows or flat cards** — either extreme feels cheap; we use subtle elevation
- **Cramped dialogs** — generous padding, comfortable line-height
- **Bare spinners** — loading states include context/messaging
- **Uppercase buttons** — prefer sentence case for approachability

## Locked Decisions

### Color Palette
- **Accent**: `#5B5BD6` (soft indigo)
- **Accent hover**: `#4A4AC4` (deeper indigo)
- **Light mode**:
  - Background: `#F7F8FA`
  - Surface: `#FFFFFF`
  - Border: `#E6E8EC`
  - Text primary: `#1A1C1F`
  - Text secondary: `#5C6370`
- **Dark mode**:
  - Background: `#0F1115`
  - Surface: `#181B20`
  - Border: `#262A31`
  - Text primary: `#F2F3F5`
  - Text secondary: `#A0A6B0`
- **Semantic**:
  - Success: `#2E9E6B`
  - Error: `#D64545`
  - Warning: `#C9861A`

### Typography
- **Font family**: Inter (via @fontsource/inter)
- **Fallback stack**: `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`

### Spacing & Radius
- **Border radius**: 8px (small), 12px (medium), 16px (large)
- **Shadows**: 
  - Small: `0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)`
  - Medium: `0 4px 12px rgba(16,24,40,0.08), 0 2px 6px rgba(16,24,40,0.06)`

### Motion
- **Durations**: 150ms (fast — hovers, fades), 220ms (base — sheets, dialogs, list items), 320ms (slow — page-level)
- **Easings**: `cubic-bezier(0.2, 0, 0, 1)` standard (decelerate — things arriving), `cubic-bezier(0.4, 0, 1, 1)` exit (accelerate — things leaving)
- **Only `transform` and `opacity` animate** (Collapse for list removal is the sanctioned exception)
- **Motion marks user-initiated appearance** — opening, adding, sending. Data refetches never animate.
- **`prefers-reduced-motion: reduce` disables everything** (global clamp in MuiCssBaseline)
- Phone bottom sheets slide up from the bottom edge; desktop dialogs use a quick Grow. Never a bare Fade for a sheet.

### Loading States
- **Skeletons for content with a knowable shape** (lists, cards, heroes, stat tiles) — MUI Skeleton, wave animation, sized to the real component so content appears without layout shift; 3 placeholder items per list.
- **Spinners only for operations** (transcribing, scanning, uploading, auth redirects) — there is no layout to mimic.
- Skeletons render on initial load only; background refetches keep stale content visible and never re-skeleton.

## Inspiration
Linear, Stripe Dashboard, Notion — clean, modern SaaS aesthetics with attention to detail.
