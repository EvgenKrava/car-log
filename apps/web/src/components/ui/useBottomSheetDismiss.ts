import { useCallback, useRef } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';
import type { DialogProps } from '@mui/material';

// Swipe-down-to-close for the phone bottom sheets (see the MuiDialog theme override).
// Returns props to spread onto a Dialog's `PaperProps`; on desktop (>= sm) or when
// `onDismiss` is undefined it returns nothing, so the sheet behaves as a normal dialog.
//
// Passing `undefined` locks the gesture — mirroring MUI's own convention where an
// undefined `onClose` means "not dismissible" (used while a scan/import is in flight).
//
// The drag only engages when the touch STARTS in the top handle zone, so scrolling the
// sheet's content (import/scan review lists) is never hijacked. Movement is applied via a
// direct style write on the paper node (no per-frame React re-render); releasing past the
// threshold animates the sheet off-screen and fires `onDismiss`, otherwise it springs back.
const HANDLE_ZONE_PX = 56; // top region that grabs the sheet
const DISMISS_THRESHOLD_PX = 110; // drag distance that commits to a close

export function useBottomSheetDismiss(
  onDismiss: (() => void) | undefined,
): Pick<DialogProps, 'PaperProps'> {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const startY = useRef<number | null>(null);
  const delta = useRef(0);
  const paper = useRef<HTMLDivElement | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const node = e.currentTarget;
    paper.current = node;
    const touch = e.touches[0];
    if (!touch) return;
    // Only start a drag from the handle zone at the very top of the sheet.
    if (touch.clientY - node.getBoundingClientRect().top > HANDLE_ZONE_PX) return;
    startY.current = touch.clientY;
    delta.current = 0;
    node.style.transition = 'none';
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dy = touch.clientY - startY.current;
    if (dy <= 0) { delta.current = 0; if (paper.current) paper.current.style.transform = ''; return; }
    delta.current = dy;
    if (paper.current) paper.current.style.transform = `translateY(${dy}px)`;
  }, []);

  const onTouchEnd = useCallback(() => {
    const node = paper.current;
    if (startY.current === null || !node) return;
    startY.current = null;
    node.style.transition = 'transform 0.2s ease';
    if (delta.current > DISMISS_THRESHOLD_PX && onDismiss) {
      // Hand the remaining travel to the Dialog's Slide exit: clear our inline
      // transform/transition so the transition component owns the paper again.
      node.style.transition = '';
      node.style.transform = '';
      onDismiss();
    } else {
      node.style.transform = '';
    }
    delta.current = 0;
  }, [onDismiss]);

  if (!isPhone || !onDismiss) return {};
  return { PaperProps: { onTouchStart, onTouchMove, onTouchEnd } };
}
