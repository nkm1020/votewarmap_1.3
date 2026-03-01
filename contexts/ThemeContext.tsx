'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'vwm-theme';

type ThemeContextValue = {
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setThemePreference: (theme: ThemePreference) => void;
  cycleThemePreference: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isValidThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const storedRaw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isValidThemePreference(storedRaw) ? storedRaw : 'system';
}

function getInitialSystemTheme(): ResolvedTheme {
  if (typeof document !== 'undefined') {
    const persistedTheme = document.documentElement.dataset.theme;
    if (persistedTheme === 'light' || persistedTheme === 'dark') {
      return persistedTheme;
    }
  }

  return getSystemTheme();
}

function applyThemeToDocument(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>('light');
  const [isHydrated, setIsHydrated] = useState(false);

  const setThemePreference = useCallback((theme: ThemePreference) => {
    setThemePreferenceState(theme);
  }, []);

  const cycleThemePreference = useCallback(() => {
    setThemePreferenceState((previous) => {
      return previous === 'system' ? 'light' : previous === 'light' ? 'dark' : 'system';
    });
  }, []);

  const resolvedTheme = useMemo<ResolvedTheme>(
    () => (themePreference === 'system' ? systemTheme : themePreference),
    [systemTheme, themePreference],
  );

  useEffect(() => {
    queueMicrotask(() => {
      setThemePreferenceState(getStoredThemePreference());
      setSystemTheme(getInitialSystemTheme());
      setIsHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    const legacyHandleChange = (event: MediaQueryListEvent) => {
      handleChange(event);
    };

    mediaQuery.addListener(legacyHandleChange);
    return () => mediaQuery.removeListener(legacyHandleChange);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    applyThemeToDocument(resolvedTheme);
  }, [isHydrated, resolvedTheme]);

  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [isHydrated, themePreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themePreference,
      resolvedTheme,
      setThemePreference,
      cycleThemePreference,
    }),
    [cycleThemePreference, resolvedTheme, setThemePreference, themePreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
