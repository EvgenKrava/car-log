import { useRef, type ReactNode } from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { tokens } from '../../theme/tokens';

// Marks user-initiated appearance of a list item: opacity 0→1 + translateY(8px)→0,
// staggered by index (capped so long lists don't crawl). Runs ONCE per mount of the
// wrapper — a TanStack refetch re-rendering the list must not re-trigger it, which is
// why the animation is keyed to mount (useRef) and not to data identity.
const STAGGER_MS = 30;
const STAGGER_CAP = 9; // items beyond the 10th appear together

export function Reveal({ index = 0, sx, children }: { index?: number; sx?: SxProps<Theme>; children: ReactNode }) {
  // Freeze the delay at first mount; re-renders keep the same node, so the CSS
  // animation (which runs once per node) never restarts.
  const delay = useRef(Math.min(index, STAGGER_CAP) * STAGGER_MS);
  return (
    <Box
      sx={[
        // Caller sx (e.g. height: '100%' so a grid item's stretch chain isn't broken)
        // spreads first so the animation properties below always win if they overlap.
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        {
          '@keyframes carlogReveal': {
            from: { opacity: 0, transform: 'translateY(8px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
          opacity: 0,
          animation: `carlogReveal ${tokens.motion.duration.base}ms ${tokens.motion.easing.standard} ${delay.current}ms forwards`,
        },
      ]}
    >
      {children}
    </Box>
  );
}
