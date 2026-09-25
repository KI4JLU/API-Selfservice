import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'api-selfservice.theme';
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let current: Theme = typeof window !== 'undefined' ? read() : 'light';

export function applyTheme(theme: Theme) {
  current = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function initTheme() {
  document.documentElement.classList.toggle('dark', current === 'dark');
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => 'light' as Theme,
  );
  return [theme, () => applyTheme(theme === 'dark' ? 'light' : 'dark')];
}
