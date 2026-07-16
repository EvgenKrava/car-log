import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'carlog.theme';

const isThemeMode = (v: string | null): v is ThemeMode =>
  v === 'system' || v === 'light' || v === 'dark';

export function readStoredThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : 'system';
  } catch {
    return 'system'; // storage blocked (private mode) — fall back silently
  }
}

type ThemeModeContextValue = { mode: ThemeMode; setMode: (mode: ThemeMode) => void };

const ThemeModeContext = createContext<ThemeModeContextValue>({ mode: 'system', setMode: () => {} });

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredThemeMode);
  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage blocked — the choice still applies for this session */
    }
  }, []);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode(): ThemeModeContextValue {
  return useContext(ThemeModeContext);
}