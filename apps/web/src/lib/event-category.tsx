import type { SvgIconComponent } from '@mui/icons-material';
import OpacityIcon from '@mui/icons-material/Opacity';
import TireRepairIcon from '@mui/icons-material/TireRepair';
import PanToolIcon from '@mui/icons-material/PanTool';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import BuildIcon from '@mui/icons-material/Build';
import CategoryIcon from '@mui/icons-material/Category';
import type { EventCategory } from '@carlog/contracts';

// A calm, muted hue per category — six distinct points on the wheel at a chroma
// that sits beside the #5B5BD6 accent without clashing. Each colour is used as a
// saturated foreground on a low-opacity tint of itself (see categoryTint), the
// same treatment the vehicle hero's StatTile uses, so categories read as part of
// the existing system rather than a bolt-on palette. Colours are picked to stay
// legible as foreground in BOTH themes (mirroring how the accent works unchanged
// in light and dark).
export const CATEGORY_META: Record<EventCategory, { color: string; Icon: SvgIconComponent }> = {
  oil_change: { color: '#C08A2E', Icon: OpacityIcon },   // amber — oil is literally amber
  tires: { color: '#6B7A8F', Icon: TireRepairIcon },     // slate — rubber/road
  brakes: { color: '#C0563E', Icon: PanToolIcon },        // terracotta — heat/stop (kept off the error red)
  inspection: { color: '#2F8F83', Icon: FactCheckIcon },  // teal — the "checked/ok" family
  repair: { color: '#3B6FD4', Icon: BuildIcon },          // blue — mechanical work
  other: { color: '#6B7280', Icon: CategoryIcon },        // neutral grey
};

// Low-opacity wash of a category colour for icon tiles / chip fills. Deeper in
// dark mode so the tint survives the darker surface — same 0.08 / 0.16 split the
// StatTile uses for the accent.
export function categoryTint(color: string, mode: 'light' | 'dark'): string {
  const n = parseInt(color.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${mode === 'dark' ? 0.16 : 0.1})`;
}