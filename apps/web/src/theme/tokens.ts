export const tokens = {
  color: {
    accent: '#5B5BD6',
    accentHover: '#4A4AC4',
    light: {
      bg: '#F7F8FA',
      surface: '#FFFFFF',
      border: '#E6E8EC',
      textPrimary: '#1A1C1F',
      textSecondary: '#5C6370',
    },
    dark: {
      bg: '#0F1115',
      surface: '#181B20',
      border: '#262A31',
      textPrimary: '#F2F3F5',
      textSecondary: '#A0A6B0',
    },
    success: '#2E9E6B',
    error: '#D64545',
    warning: '#C9861A',
  },
  radius: { sm: 8, md: 12, lg: 16 },
  shadow: {
    sm: '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)',
    md: '0 4px 12px rgba(16,24,40,0.08), 0 2px 6px rgba(16,24,40,0.06)',
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
  font: { family: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
} as const;
