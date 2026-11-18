// Only Tools design tokens (direction B "Конструктор"), CarLog's accent is the car orange.
// Mirrors only-tools-core/packages/ui/only-tools.css: change colours there first, then here,
// so every Only Tools app keeps one style. MUI needs literal colours (it derives hover and
// alpha shades from them), which is why they are copied rather than read from CSS variables.
export const tokens = {
  color: {
    accent: '#FF7A45',
    accentHover: '#E8642F',
    light: {
      bg: '#FFF8F1',                      // --ot-bg: warm paper
      surface: '#FFFFFF',                 // --ot-surface
      border: '#EFE4D8',                  // --ot-line
      fill: '#FDF3E8',                    // --ot-surface-2 (search fields, segmented tracks)
      textPrimary: '#2A2140',             // --ot-ink: plum ink
      textSecondary: '#71698A',           // --ot-mut
      textTertiary: 'rgba(113, 105, 138, 0.55)',
      glass: 'rgba(255, 253, 250, 0.92)', // --ot-bar
      tint: '#FF7A45',                    // --ot-car
      success: '#1A9A68',
      error: '#D93A4A',
      warning: '#C77700',
    },
    dark: {
      bg: '#17141F',
      surface: '#221D2E',
      border: '#342D44',
      fill: '#1D1927',
      textPrimary: '#F3EEFA',
      textSecondary: '#A59CBA',
      textTertiary: 'rgba(165, 156, 186, 0.55)',
      glass: 'rgba(29, 25, 39, 0.92)',
      tint: '#FF8A5C',
      success: '#2FD08F',
      error: '#FF6B7A',
      warning: '#FFB547',
    },
    success: '#1A9A68',
    error: '#D93A4A',
    warning: '#C77700',
  },
  // sm: inputs/menus · md: dialogs · lg: cards (inset grouped cells) · sheet: phone bottom sheets
  radius: { sm: 14, md: 24, lg: 20, sheet: 24 },
  shadow: {
    sm: '0 4px 14px -10px rgba(42, 33, 64, 0.3)',
    md: '0 8px 24px -16px rgba(42, 33, 64, 0.35)',
  },
  // Motion: quiet confidence — things arrive decelerating, leave accelerating.
  // Animate only transform/opacity; user-initiated appearance only (never refetches).
  motion: {
    duration: { fast: 150, base: 220, slow: 320 }, // ms
    easing: {
      standard: 'cubic-bezier(0.2, 0, 0, 1)', // decelerate — arriving
      exit: 'cubic-bezier(0.4, 0, 1, 1)',     // accelerate — leaving
    },
  },
  // Nunito everywhere (self-hosted via @fontsource/nunito), rounded system fonts as the fallback.
  font: {
    family: "'Nunito', ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif",
    rounded: "'Nunito', ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, sans-serif",
  },
} as const;
