'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HELPI_DISCLAIMER,
  hintFor,
  type HelpiHint,
} from '../../lib/helpi-hints';
import { ArrowRightIcon, CompassIcon, XIcon } from '../ui/icons';
import styles from './helpi.module.css';

const DISMISSED_KEY = 'helpi-dismissed';
const SEEN_KEY = 'helpi-seen';
/** Lets the footer's restore control reach Helpi without shared state. */
export const HELPI_RESTORE_EVENT = 'helpi:restore';
export const HELPI_DISMISS_EVENT = 'helpi:dismiss';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    // Blocked storage must not disable the guide, only its memory.
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    if (value) {
      localStorage.setItem(key, 'true');
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // The choice simply will not persist.
  }
}

/**
 * A small floating product guide for the public pages.
 *
 * It is a disclosure, not a dialog: it never traps focus, never covers the
 * page and never steals focus when it appears on its own — it is
 * supplementary, so it must not interrupt anyone. Hints come from
 * `helpi-hints.ts`; there is deliberately no text input and no
 * conversation, because Helpi is written guidance rather than AI.
 */
export function Helpi() {
  const pathname = usePathname();
  // Nothing renders until mounted: the dismissal flag lives in
  // localStorage, which the server cannot know, and guessing would either
  // flash the panel or hide it wrongly.
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
    setDismissed(readFlag(DISMISSED_KEY));
  }, []);

  // First desktop visit opens the panel once, without taking focus. On
  // small screens Helpi waits to be tapped: space is scarce there.
  useEffect(() => {
    if (!mounted || dismissed || readFlag(SEEN_KEY)) {
      return;
    }
    let roomToSpare = true;
    try {
      roomToSpare = window.matchMedia('(min-width: 640px)').matches;
    } catch {
      roomToSpare = false;
    }
    if (roomToSpare) {
      setOpen(true);
    }
    writeFlag(SEEN_KEY, true);
  }, [mounted, dismissed]);

  useEffect(() => {
    function restore() {
      writeFlag(DISMISSED_KEY, false);
      setDismissed(false);
      setOpen(true);
    }
    window.addEventListener(HELPI_RESTORE_EVENT, restore);
    return () => window.removeEventListener(HELPI_RESTORE_EVENT, restore);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  const dismiss = useCallback(() => {
    writeFlag(DISMISSED_KEY, true);
    setDismissed(true);
    setOpen(false);
    window.dispatchEvent(new Event(HELPI_DISMISS_EVENT));
  }, []);

  const hint: HelpiHint | null = hintFor(pathname);

  if (!mounted || dismissed || !hint) {
    return null;
  }

  return (
    <div
      className={styles.root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      {open ? (
        <div id="helpi-panel" className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelName}>Helpi</span>
            <button
              type="button"
              className={styles.iconButton}
              onClick={close}
              aria-label="Close Helpi"
            >
              <XIcon size={15} />
            </button>
          </div>

          <p className={styles.message}>{hint.message}</p>

          {hint.action ? (
            <Link href={hint.action.href} className={styles.action}>
              {hint.action.label}
              <ArrowRightIcon size={14} />
            </Link>
          ) : null}

          <div className={styles.panelFoot}>
            <p className={styles.disclaimer}>{HELPI_DISCLAIMER}</p>
            <button type="button" className={styles.dismiss} onClick={dismiss}>
              Don&apos;t show again
            </button>
          </div>
        </div>
      ) : null}

      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        aria-expanded={open}
        aria-controls="helpi-panel"
        // A disclosure keeps one stable name and lets aria-expanded carry
        // the state; renaming it would also collide with the panel's own
        // close button.
        aria-label="Helpi, the product guide"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <CompassIcon size={20} />
      </button>
    </div>
  );
}

/**
 * Footer control that brings Helpi back after it has been dismissed —
 * without it, one click would remove the guide permanently with no way
 * back. Renders only when Helpi is actually hidden.
 */
export function HelpiRestore() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(readFlag(DISMISSED_KEY));
    function onDismiss() {
      setVisible(true);
    }
    window.addEventListener(HELPI_DISMISS_EVENT, onDismiss);
    return () => window.removeEventListener(HELPI_DISMISS_EVENT, onDismiss);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <button
      type="button"
      className={styles.restore}
      onClick={() => {
        setVisible(false);
        window.dispatchEvent(new Event(HELPI_RESTORE_EVENT));
      }}
    >
      Show Helpi again
    </button>
  );
}
