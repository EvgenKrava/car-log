// iOS semantic colours (Human Interface Guidelines system palette) with CarLog's
// indigo kept as the tint. Surfaces follow the "inset grouped" model: a grouped
// background with flat white/charcoal cells on top, separated by translucent
// hairlines rather than borders and shadows.
export const tokens = {
  color: {
    accent: '#5B5BD6',
    accentHover: '#4A4AC4',
    light: {
      bg: '#F2F2F7',                      // systemGroupedBackground
      surface: '#FFFFFF',                 // secondarySystemGroupedBackground
      border: 'rgba(60, 60, 67, 0.29)',   // separator
      fill: 'rgba(120, 120, 128, 0.12)',  // tertiarySystemFill (search fields, segmented tracks)
      textPrimary: '#000000',
      textSecondary: 'rgba(60, 60, 67, 0.6)',
      textTertiary: 'rgba(60, 60, 67, 0.3)',
      glass: 'rgba(255, 255, 255, 0.78)', // translucent bars
      tint: '#5B5BD6',
      success: '#34C759',
      error: '#FF3B30',
      warning: '#FF9500',
    },
    dark: {
      bg: '#000000',
      surface: '#1C1C1E',
      border: 'rgba(84, 84, 88, 0.65)',
      fill: 'rgba(118, 118, 128, 0.24)',
      textPrimary: '#FFFFFF',
      textSecondary: 'rgba(235, 235, 245, 0.6)',
      textTertiary: 'rgba(235, 235, 245, 0.3)',
      glass: 'rgba(28, 28, 30, 0.78)',
      tint: '#8A8AF0',                    // indigo lifted for contrast on black
      success: '#30D158',
      error: '#FF453A',
      warning: '#FF9F0A',
    },
    success: '#34C759',
    error: '#FF3B30',
    warning: '#FF9500',
  },
  // sm: inputs/menus · md: dialogs · lg: cards (inset grouped cells) · sheet: phone bottom sheets
  radius: { sm: 12, md: 28, lg: 20, sheet: 34 },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.08)',
    md: '0 8px 24px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)',
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
  // System font first (SF Pro on Apple devices); Inter is the bundled fallback elsewhere.
  font: {
    family: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter', system-ui, 'Segoe UI', Roboto, sans-serif",
    rounded: "ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif",
  },
} as const;
