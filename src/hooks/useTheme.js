import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'theme-preference';

function getStoredPreference() {
  if (typeof window === 'undefined') return 'light';
  return localStorage.getItem(STORAGE_KEY) || 'light';
}

function getEffectiveDark(preference) {
  if (preference === 'dark') return true;
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function useTheme() {
  const [preference, setPreference] = useState(getStoredPreference);
  const [isDark, setIsDark] = useState(() => getEffectiveDark(getStoredPreference()));

  // Apply theme to <html> and persist preference
  useEffect(() => {
    const dark = getEffectiveDark(preference);
    setIsDark(dark);
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  // Listen to system preference changes when in 'system' mode
  useEffect(() => {
    if (preference !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const dark = getEffectiveDark('system');
      setIsDark(dark);
      document.documentElement.classList.toggle('dark', dark);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [preference]);

  const setTheme = useCallback((pref) => {
    setPreference(pref);
  }, []);

  return { preference, isDark, setTheme };
}