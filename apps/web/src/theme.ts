import { createTheme, type Theme } from '@mui/material/styles';
import { tokens } from './theme/tokens';

// Phone-first breakpoint for the type ramp: iOS text sizes (17pt body) on
// phones, one step tighter on wider screens where the same copy sits in
// denser layouts.
const PHONE = '@media (max-width:599.95px)';

export const buildTheme = (mode: 'light' | 'dark'): Theme => {
  const c = mode === 'dark' ? tokens.color.dark : tokens.color.light;
  // Selected segment of a segmented control (ToggleButtonGroup): white on light,
  // the iOS "selected segment" grey on dark — a white cell would glare on black.
  const segmentSelected = mode === 'dark' ? '#636366' : '#FFFFFF';
  const glassBlur = 'saturate(180%) blur(20px)';
  return createTheme({
    palette: {
      mode,
      primary: { main: c.tint, dark: mode === 'dark' ? '#7373E0' : tokens.color.accentHover, contrastText: '#FFFFFF' },
      success: { main: c.success },
      error: { main: c.error },
      warning: { main: c.warning },
      background: { default: c.bg, paper: c.surface },
      text: { primary: c.textPrimary, secondary: c.textSecondary, disabled: c.textTertiary },
      divider: c.border,
    },
    shape: { borderRadius: tokens.radius.sm },
    typography: {
      fontFamily: tokens.font.family,
      // iOS text styles: Large Title / Title 2 / Headline / Body / Subheadline / Footnote.
      h4: { fontSize: '2.125rem', lineHeight: 41 / 34, fontWeight: 700, letterSpacing: '0.01em' },
      h5: { fontSize: '1.375rem', lineHeight: 28 / 22, fontWeight: 700, letterSpacing: '-0.01em' },
      h6: { fontSize: '1.0625rem', lineHeight: 22 / 17, fontWeight: 600, letterSpacing: '-0.01em' },
      subtitle1: { fontSize: '1.0625rem', lineHeight: 22 / 17, fontWeight: 600, letterSpacing: '-0.01em' },
      subtitle2: { fontSize: '0.9375rem', lineHeight: 20 / 15, fontWeight: 600 },
      body1: { fontSize: '1rem', lineHeight: 22 / 16, letterSpacing: '-0.01em', [PHONE]: { fontSize: '1.0625rem', lineHeight: 22 / 17 } },
      body2: { fontSize: '0.9375rem', lineHeight: 20 / 15, letterSpacing: '-0.01em' },
      caption: { fontSize: '0.8125rem', lineHeight: 18 / 13 },
      overline: { fontSize: '0.8125rem', lineHeight: 18 / 13, letterSpacing: '-0.01em', fontWeight: 400 },
      button: { fontWeight: 600, letterSpacing: '-0.01em' },
    },
    components: {
      MuiCssBaseline: {
        // This clamp is CSS-only, so visuals are instant, but MUI's Transition
        // components (e.g. Slide/Grow here) still run their full JS timeout before
        // firing onExited — the unmount is delayed even though nothing visibly moves.
        styleOverrides: `
          html { -webkit-tap-highlight-color: transparent; }
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0.01ms !important;
            }
          }
        `,
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          // Capsule buttons; 44pt minimum touch target at the default size.
          root: { textTransform: 'none', borderRadius: 999 },
          sizeSmall: { minHeight: 32, paddingLeft: 14, paddingRight: 14 },
          sizeMedium: { minHeight: 44, paddingLeft: 20, paddingRight: 20 },
          sizeLarge: { minHeight: 50, paddingLeft: 24, paddingRight: 24, fontSize: '1.0625rem' },
          outlined: { borderColor: c.border },
        },
      },
      MuiFab: {
        defaultProps: { color: 'primary' },
        styleOverrides: { root: { boxShadow: tokens.shadow.md } },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: tokens.radius.lg },
        },
      },
      // Inset-grouped cells: flat surfaces on the grouped background, no border, no shadow.
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { borderRadius: tokens.radius.lg, border: 'none', boxShadow: 'none', backgroundImage: 'none' },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'default' },
        styleOverrides: {
          root: {
            backgroundColor: c.glass,
            backdropFilter: glassBlur,
            WebkitBackdropFilter: glassBlur,
            color: c.textPrimary,
            borderBottom: 'none',
            boxShadow: 'none',
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
            borderRadius: tokens.radius.md,
            [theme.breakpoints.down('sm')]: {
              '&:not(.carlog-no-sheet)': {
                alignSelf: 'flex-end',
                margin: 0,
                width: '100%',
                maxWidth: '100%',
                maxHeight: '92vh',
                borderTopLeftRadius: tokens.radius.sheet,
                borderTopRightRadius: tokens.radius.sheet,
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 6,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 36,
                  height: 5,
                  borderRadius: 999,
                  backgroundColor: c.textTertiary,
                  pointerEvents: 'none',
                  zIndex: 1,
                },
                // Nudge the title down so it clears the drag handle.
                '& .MuiDialogTitle-root': { paddingTop: 22 },
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
      MuiDialogTitle: {
        styleOverrides: { root: { fontSize: '1.0625rem', fontWeight: 600, lineHeight: 22 / 17 } },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: tokens.radius.sm },
          notchedOutline: { borderColor: c.border },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 999, fontWeight: 600 },
          filled: { backgroundColor: c.fill },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 14,
            minWidth: 200,
            backgroundColor: c.glass,
            backdropFilter: glassBlur,
            WebkitBackdropFilter: glassBlur,
            boxShadow: tokens.shadow.md,
          },
          list: { paddingTop: 6, paddingBottom: 6 },
        },
      },
      MuiMenuItem: {
        styleOverrides: { root: { minHeight: 44, fontSize: '1.0625rem' } },
      },
      MuiAlert: {
        styleOverrides: { root: { borderRadius: 14 } },
      },
      MuiSnackbarContent: {
        styleOverrides: { root: { borderRadius: 14 } },
      },
      MuiListSubheader: {
        // Section headers of grouped lists: uppercase footnote, no background.
        styleOverrides: {
          root: {
            backgroundColor: 'transparent',
            color: c.textSecondary,
            fontSize: '0.8125rem',
            lineHeight: 18 / 13,
            textTransform: 'uppercase',
            letterSpacing: '-0.01em',
            paddingBottom: 6,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: { root: { borderRadius: 999, height: 6, backgroundColor: c.fill }, bar: { borderRadius: 999 } },
      },
      // Segmented control: a filled track with the selected segment lifted as a white pill.
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: { backgroundColor: c.fill, borderRadius: 9, padding: 2, gap: 2 },
          grouped: {
            border: 0,
            borderRadius: 7,
            '&:not(:first-of-type)': { borderRadius: 7, marginLeft: 0, borderLeft: 0 },
            '&:not(:last-of-type)': { borderRadius: 7 },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            border: 0,
            fontWeight: 500,
            color: c.textPrimary,
            minHeight: 30,
            paddingTop: 3,
            paddingBottom: 3,
            '&.Mui-selected': {
              backgroundColor: segmentSelected,
              color: c.textPrimary,
              fontWeight: 600,
              boxShadow: '0 3px 8px rgba(0,0,0,0.12), 0 3px 1px rgba(0,0,0,0.04)',
              '&:hover': { backgroundColor: segmentSelected },
            },
          },
        },
      },
      // The iOS toggle: 51×31 capsule, white thumb, green when on.
      MuiSwitch: {
        styleOverrides: {
          root: { width: 51, height: 31, padding: 0 },
          switchBase: {
            padding: 2,
            '&.Mui-checked': {
              transform: 'translateX(20px)',
              color: '#FFFFFF',
              '& + .MuiSwitch-track': { backgroundColor: c.success, opacity: 1 },
            },
            '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.4 },
          },
          thumb: { width: 27, height: 27, boxShadow: '0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.16)' },
          track: { borderRadius: 999, backgroundColor: mode === 'dark' ? 'rgba(118,118,128,0.36)' : 'rgba(120,120,128,0.2)', opacity: 1 },
        },
      },
    },
  });
};
