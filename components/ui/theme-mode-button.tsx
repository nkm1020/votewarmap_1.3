'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useMemo } from 'react';
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext';

type ThemeModeButtonProps = {
  className?: string;
};

function joinClasses(...tokens: Array<string | undefined | false | null>): string {
  return tokens.filter(Boolean).join(' ');
}

const THEME_LABEL: Record<ThemePreference, string> = {
  system: '시스템',
  light: '라이트',
  dark: '다크',
};

const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

export function ThemeModeButton({ className }: ThemeModeButtonProps) {
  const { themePreference, cycleThemePreference } = useTheme();

  const { icon, nextLabel, currentLabel } = useMemo(() => {
    const currentLabelValue = THEME_LABEL[themePreference];
    const nextLabelValue = THEME_LABEL[NEXT_THEME[themePreference]];

    if (themePreference === 'light') {
      return { icon: <Sun className="h-4 w-4" />, nextLabel: nextLabelValue, currentLabel: currentLabelValue };
    }

    if (themePreference === 'dark') {
      return { icon: <Moon className="h-4 w-4" />, nextLabel: nextLabelValue, currentLabel: currentLabelValue };
    }

    return { icon: <Monitor className="h-4 w-4" />, nextLabel: nextLabelValue, currentLabel: currentLabelValue };
  }, [themePreference]);

  return (
    <button
      type="button"
      onClick={cycleThemePreference}
      title={`현재 테마: ${currentLabel} (클릭 시 ${nextLabel})`}
      aria-label={`테마 모드 전환: 현재 ${currentLabel}, 다음 ${nextLabel}`}
      className={joinClasses(
        'inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--header-border)] bg-[var(--header-hover-bg)] text-[color:var(--header-text-muted)] transition hover:bg-[var(--header-active-bg)] hover:text-[color:var(--header-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-accent)]',
        className,
      )}
    >
      {icon}
    </button>
  );
}

