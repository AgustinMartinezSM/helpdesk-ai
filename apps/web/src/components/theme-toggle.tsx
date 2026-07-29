'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './ui/icons';
import styles from './theme-toggle.module.css';

/**
 * Shared by the public and authenticated shells. Icon choice is
 * CSS-driven off `[data-theme]` so the pre-hydration paint already shows
 * the right glyph; React state only exists to expose the toggle state
 * (`aria-pressed`) to assistive tech after mount.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    );
  }, []);

  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // private mode — the choice just won't persist
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={toggle}
      aria-label="Dark theme"
      aria-pressed={theme === null ? undefined : theme === 'dark'}
    >
      <SunIcon size={18} className={styles.sun} />
      <MoonIcon size={18} className={styles.moon} />
    </button>
  );
}
