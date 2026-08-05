import {
  forwardRef, useRef,
  type FormEventHandler, type ReactElement, type ReactNode, type Ref,
} from 'react';
import {
  Dialog, DialogActions, DialogContent, DialogTitle,
  Grow, Slide, useMediaQuery, useTheme,
  type DialogProps,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { TransitionProps } from '@mui/material/transitions';
import { tokens } from '../../theme/tokens';
import { useBottomSheetDismiss } from './useBottomSheetDismiss';

export type ModalProps = {
  open: boolean;
  /** Omit to make the modal non-dismissible (backdrop/Esc and the mobile swipe are
   *  both locked) — e.g. while a scan/import is in flight. */
  onClose?: () => void;
  /** Header text/element. Omit for a chromeless modal (e.g. a media lightbox). */
  title?: ReactNode;
  /** Footer actions (buttons). Rendered in DialogActions — on mobile the theme
   *  floats these to the top of the sheet. */
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: DialogProps['maxWidth'];
  fullWidth?: boolean;
  /** Add top/bottom dividers around the scrollable content. */
  dividers?: boolean;
  /** When provided, content + actions are wrapped in a <form> with this submit
   *  handler. Required for form modals so the theme's mobile actions-to-top
   *  reordering (which targets `& > form`) keeps working. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Opt out of the mobile bottom-sheet treatment — a centered dialog on every
   *  breakpoint. Use for media lightboxes whose gestures fight the sheet. */
  plain?: boolean;
  /** sx applied to the scrollable DialogContent. */
  contentSx?: SxProps<Theme>;
  /** Escape hatch: extra props forwarded to the underlying MUI Dialog. */
  dialogProps?: Partial<DialogProps>;
};

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

// The project's universal modal: a real centered dialog on desktop, a bottom sheet
// on phones (drag handle + swipe-to-dismiss + actions-to-top). The responsive
// behaviour lives in the MuiDialog theme override; this component removes the
// per-modal boilerplate and wires the swipe-dismiss hook.
export function Modal({
  open, onClose, title, actions, children,
  maxWidth = 'sm', fullWidth = true, dividers = false, onSubmit, plain = false,
  contentSx, dialogProps,
}: ModalProps) {
  // `plain` opts out of the sheet: lock the gesture and tag the paper so the theme
  // skips its bottom-sheet rules. Otherwise wire swipe-to-dismiss to onClose.
  const sheet = useBottomSheetDismiss(plain ? undefined : onClose);
  const mergedClassName = plain
    ? ['carlog-no-sheet', dialogProps?.PaperProps?.className].filter(Boolean).join(' ')
    : dialogProps?.PaperProps?.className;
  const paperProps = {
    ...sheet.PaperProps,
    ...dialogProps?.PaperProps,
    ...(mergedClassName ? { className: mergedClassName } : {}),
  };

  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  // Freeze the breakpoint choice while open: flipping TransitionComponent identity
  // mid-open (rotation across `sm`) remounts the dialog subtree and loses form state.
  const frozenIsPhone = useRef(isPhone);
  if (!open) frozenIsPhone.current = isPhone;
  // `plain` (lightbox) keeps the default Fade; a slide-up would fight its gestures.
  const TransitionComponent = plain
    ? undefined
    : frozenIsPhone.current ? SheetTransition : DesktopTransition;

  const body = (
    <>
      {title != null ? <DialogTitle>{title}</DialogTitle> : null}
      <DialogContent dividers={dividers} sx={contentSx}>{children}</DialogContent>
      {actions != null ? <DialogActions>{actions}</DialogActions> : null}
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth={fullWidth}
      maxWidth={maxWidth}
      {...(TransitionComponent ? { TransitionComponent } : {})}
      {...dialogProps}
      PaperProps={paperProps}
    >
      {onSubmit ? <form onSubmit={onSubmit}>{body}</form> : body}
    </Dialog>
  );
}