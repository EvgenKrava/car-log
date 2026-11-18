import type { SvgIconComponent } from '@mui/icons-material';
import OpacityIcon from '@mui/icons-material/Opacity';
import TireRepairIcon from '@mui/icons-material/TireRepair';
import PanToolIcon from '@mui/icons-material/PanTool';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import BuildIcon from '@mui/icons-material/Build';
import CategoryIcon from '@mui/icons-material/Category';
import type { EventCategory } from '@carlog/contracts';

// One Only Tools palette colour per category (see only-tools.css). Each colour is used as
// a saturated foreground on a low-opacity tint of itself (see categoryTint), the same
// treatment the vehicle hero's StatTile uses.
export const CATEGORY_META: Record<EventCategory, { color: string; Icon: SvgIconComponent }> = {
  oil_change: { color: '#C77700', Icon: OpacityIcon },   // Only Tools warn — oil is amber
  tires: { color: '#7B5CFF', Icon: TireRepairIcon },     // Only Tools violet — road/rubber
  brakes: { color: '#D93A4A', Icon: PanToolIcon },        // Only Tools bad — heat/stop
  inspection: { color: '#1A9A68', Icon: FactCheckIcon },  // Only Tools good — the "checked/ok" family
  repair: { color: '#FF7A45', Icon: BuildIcon },          // CarLog orange — mechanical work
  other: { color: '#71698A', Icon: CategoryIcon },        // Only Tools muted
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