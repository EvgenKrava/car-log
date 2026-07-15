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
                '& > .MuiDialogTitle-root': { paddingTop: 20 },
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
