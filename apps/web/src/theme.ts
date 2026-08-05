import { createTheme, type Theme } from '@mui/material/styles';
import { tokens } from './theme/tokens';

export const buildTheme = (mode: 'light' | 'dark'): Theme => {
  const c = mode === 'dark' ? tokens.color.dark : tokens.color.light;
  return createTheme({
    palette: {
      mode,
      primary: { main: tokens.color.accent, dark: tokens.color.accentHover },
      success: { main: tokens.color.success },
      error: { main: tokens.color.error },
      warning: { main: tokens.color.warning },
      background: { default: c.bg, paper: c.surface },
      text: { primary: c.textPrimary, secondary: c.textSecondary },
      divider: c.border,
    },
    shape: { borderRadius: tokens.radius.md },
    typography: {
      fontFamily: tokens.font.family,
      h5: { fontWeight: 700, letterSpacing: '-0.02em' },
      h6: { fontWeight: 700, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 600 },
      button: { fontWeight: 600 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { textTransform: 'none', borderRadius: tokens.radius.sm },
        },
      },
      MuiPaper: {
        styleOverrides: { rounded: { borderRadius: tokens.radius.md } },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.lg,
            border: `1px solid ${c.border}`,
            boxShadow: tokens.shadow.sm,
            backgroundImage: 'none',
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'default' },
        styleOverrides: {
          root: {
            backgroundColor: c.surface,
            color: c.textPrimary,
            borderBottom: `1px solid ${c.border}`,
            backgroundImage: 'none',
          },
        },
      },
      MuiCssBaseline: {
        // This clamp is CSS-only, so visuals are instant, but MUI's Transition
        // components (e.g. Slide/Grow here) still run their full JS timeout before
        // firing onExited — the unmount is delayed even though nothing visibly moves.
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
      MuiDialog: {
        styleOverrides: {
          // On phones, dialogs become bottom sheets (Telegram/iOS style): anchored to the
          // bottom edge, full width, rounded top corners only, tall (up to 92vh) with a
          // little gap at the very top, and a small drag-handle affordance. `alignSelf`
          // overrides the container's vertical centering for this paper alone — no global
          // container override needed. Desktop (>= sm) is untouched: normal centered dialog.
          // Image lightboxes opt out via the `carlog-no-sheet` class (a bottom sheet would
          // fight their pinch-zoom / swipe-to-navigate gestures).
          paper: ({ theme }) => ({
            borderRadius: tokens.radius.lg,
            [theme.breakpoints.down('sm')]: {
              '&:not(.carlog-no-sheet)': {
                alignSelf: 'flex-end',
                margin: 0,
                width: '100%',
                maxWidth: '100%',
                maxHeight: '92vh',
                borderTopLeftRadius: tokens.radius.lg,
                borderTopRightRadius: tokens.radius.lg,
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 8,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.palette.divider,
                  pointerEvents: 'none',
                  zIndex: 1,
                },
                // Nudge the title down so it clears the drag handle.
                '& .MuiDialogTitle-root': { paddingTop: 20 },
                // On phones the actions bar (Cancel/Save) moves to the TOP — a bottom sheet
                // can be tall and the buttons would otherwise sit far below the fold. Using
                // flex `order` gives Title → Actions → Content without restructuring any
                // dialog. Form-wrapped dialogs (Car/Event) nest these under a <form>, so make
                // the form a flex column too; the descendant `order` rules then apply in both
                // the form-wrapped and the direct-child cases.
                '& > form': { display: 'flex', flexDirection: 'column', minHeight: 0 },
                '& .MuiDialogActions-root': {
                  order: 1,
                  borderBottom: `1px solid ${c.border}`,
                  // Keep the actions grouped on the right (MUI's default), not spread apart.
                  justifyContent: 'flex-end',
                },
                '& .MuiDialogContent-root': { order: 2 },
              },
            },
          }),
        },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiChip: { styleOverrides: { root: { borderRadius: tokens.radius.sm, fontWeight: 600 } } },
    },
  });
};
