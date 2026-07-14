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
        styleOverrides: { paper: { borderRadius: tokens.radius.lg } },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiChip: { styleOverrides: { root: { borderRadius: tokens.radius.sm, fontWeight: 600 } } },
    },
  });
};
