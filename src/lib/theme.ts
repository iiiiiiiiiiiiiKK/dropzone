import { useEffect, useState } from 'react';
import { STORAGE_KEYS, type ThemeMode } from './constants';

function readStored(): ThemeMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.theme);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function initialTheme(): ThemeMode {
  const stored = readStored();
  if (stored) return stored;
  const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark === false ? 'light' : 'dark';
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('light', mode === 'light');
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'light' ? '#f7f7f8' : '#0a0b0d');
  try {
    localStorage.setItem(STORAGE_KEYS.theme, mode);
  } catch {
    /* private mode */
  }
}

export function useTheme(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => initialTheme());
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);
  return [mode, setMode];
}
