import type { CSSProperties } from 'react';

export type PageThemeTokens = {
  isDark: boolean;
  shellClass: string;
  surfaceClass: string;
  surfaceStrongClass: string;
  surfaceSoftClass: string;
  elevatedClass: string;
  inputClass: string;
  dockClass: string;
  dockInnerClass: string;
  textPrimaryClass: string;
  textSecondaryClass: string;
  textMutedClass: string;
  textSubtleClass: string;
  borderClass: string;
  borderSoftClass: string;
  chipClass: string;
  chipMutedClass: string;
  overlayClass: string;
};

export function getPageThemeTokens(isDark: boolean): PageThemeTokens {
  return {
    isDark,
    shellClass: 'vwm-theme-shell',
    surfaceClass: 'border vwm-theme-surface',
    surfaceStrongClass: 'border vwm-theme-surface-strong',
    surfaceSoftClass: isDark
      ? 'border border-white/10 bg-white/[0.04]'
      : 'border border-slate-200/90 bg-slate-900/[0.04]',
    elevatedClass: 'border vwm-theme-surface-elevated',
    inputClass:
      'vwm-theme-input border placeholder:text-[color:var(--app-text-subtle)] focus:border-[#ff9f0a66] focus:ring-2 focus:ring-[#ff9f0a33]',
    dockClass: 'border-t vwm-theme-dock',
    dockInnerClass: 'border vwm-theme-dock-inner',
    textPrimaryClass: 'text-[color:var(--app-text-primary)]',
    textSecondaryClass: 'text-[color:var(--app-text-secondary)]',
    textMutedClass: 'text-[color:var(--app-text-muted)]',
    textSubtleClass: 'text-[color:var(--app-text-subtle)]',
    borderClass: 'border-[color:var(--app-border)]',
    borderSoftClass: isDark ? 'border-white/10' : 'border-slate-200/80',
    chipClass: isDark
      ? 'border border-white/16 bg-white/8 text-white/84'
      : 'border border-slate-200 bg-slate-900/[0.05] text-slate-700',
    chipMutedClass: isDark
      ? 'border border-white/14 bg-white/6 text-white/72'
      : 'border border-slate-200 bg-slate-900/[0.04] text-slate-600',
    overlayClass: 'vwm-theme-backdrop',
  };
}

export function getMyPageThemeVars(isDark: boolean): CSSProperties {
  if (isDark) {
    return {
      '--my-bg': '#070d16',
      '--my-bg-shell': '#0a1220',
      '--my-surface': 'rgba(12,18,28,0.78)',
      '--my-surface-strong': 'rgba(12,18,28,0.86)',
      '--my-surface-soft': 'rgba(255,255,255,0.04)',
      '--my-border': 'rgba(255,255,255,0.14)',
      '--my-border-soft': 'rgba(255,255,255,0.1)',
      '--my-text-main': 'rgba(255,255,255,0.96)',
      '--my-text-muted': 'rgba(255,255,255,0.68)',
      '--my-text-subtle': 'rgba(255,255,255,0.54)',
      '--my-accent': '#ff9f0a',
      '--my-accent-strong': '#ff6b00',
      '--my-accent-soft': 'rgba(255,107,0,0.18)',
      '--my-focus': 'rgba(255,159,10,0.52)',
      '--my-chart-region': '#9d6bff',
      '--my-chart-nation': '#4f8dff',
      '--my-chart-neutral': 'rgba(255,255,255,0.28)',
      '--my-chart-vote': '#ff9f0a',
      '--my-chart-game': '#57c8ff',
      '--my-chart-grid': 'rgba(255,255,255,0.12)',
    } as CSSProperties;
  }

  return {
    '--my-bg': '#edf2f8',
    '--my-bg-shell': '#f6f8fc',
    '--my-surface': 'rgba(255,255,255,0.84)',
    '--my-surface-strong': 'rgba(255,255,255,0.94)',
    '--my-surface-soft': 'rgba(15,23,42,0.04)',
    '--my-border': 'rgba(15,23,42,0.12)',
    '--my-border-soft': 'rgba(15,23,42,0.08)',
    '--my-text-main': '#0f172a',
    '--my-text-muted': 'rgba(15,23,42,0.72)',
    '--my-text-subtle': 'rgba(15,23,42,0.52)',
    '--my-accent': '#ff8a1f',
    '--my-accent-strong': '#ff6b00',
    '--my-accent-soft': 'rgba(255,107,0,0.14)',
    '--my-focus': 'rgba(255,159,10,0.42)',
    '--my-chart-region': '#7c5cff',
    '--my-chart-nation': '#2563eb',
    '--my-chart-neutral': 'rgba(15,23,42,0.18)',
    '--my-chart-vote': '#ff8a1f',
    '--my-chart-game': '#0ea5e9',
    '--my-chart-grid': 'rgba(15,23,42,0.1)',
  } as CSSProperties;
}
