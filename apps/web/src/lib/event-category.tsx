import type { SvgIconComponent } from '@mui/icons-material';
import OpacityIcon from '@mui/icons-material/Opacity';
import TireRepairIcon from '@mui/icons-material/TireRepair';
import PanToolIcon from '@mui/icons-material/PanTool';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import BuildIcon from '@mui/icons-material/Build';
import CategoryIcon from '@mui/icons-material/Category';
import type { EventCategory } from '@carlog/contracts';

// One iOS system colour per category — the same hues the platform uses for its
// own tags, so categories read as native beside the indigo tint. Each colour is
// used as a saturated foreground on a low-opacity tint of itself (see
// categoryTint), the same treatment the vehicle hero's StatTile uses. Brakes take
// pink rather than the error red so an overdue badge never looks like a category.
export const CATEGORY_META: Record<EventCategory, { color: string; Icon: SvgIconComponent }> = {
  oil_change: { color: '#FF9500', Icon: OpacityIcon },   // systemOrange — oil is amber
  tires: { color: '#32ADE6', Icon: TireRepairIcon },     // systemCyan — road/rubber
  brakes: { color: '#FF2D55', Icon: PanToolIcon },        // systemPink — heat/stop, off the error red
  inspection: { color: '#34C759', Icon: FactCheckIcon },  // systemGreen — the "checked/ok" family
  repair: { color: '#007AFF', Icon: BuildIcon },          // systemBlue — mechanical work
  other: { color: '#8E8E93', Icon: CategoryIcon },        // systemGray
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