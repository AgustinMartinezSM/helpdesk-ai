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
    /*
     * Transitions off for the duration of the swap (Sprint 10.8), which is a
     * CORRECTNESS guard and not a polish one. A `transition` on `color` bound
     * to a theme token never lands on the new value: the element keeps the
     * previous theme's colour indefinitely, so pressing this very button left
     * the primary navigation — and this button — painted in the other theme's
     * ink, at 2.36:1. The matching rule is in global.css.
     *
     * Two frames, not one: the attribute has to be committed and the new
     * values painted before transitions come back, or re-enabling them in the
     * same frame reintroduces exactly what this prevents.
     */
    root.dataset.themeSwitching = '';
    root.dataset.theme = next;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        delete root.dataset.themeSwitching;
      });
    });
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
