'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { PUBLIC_NAV_LINKS } from '../../lib/site-config';
import { useAuth } from '../auth-context';
import { ThemeToggle } from '../theme-toggle';
import { ButtonLink } from '../ui/button';
import { MenuIcon, XIcon } from '../ui/icons';
import styles from './public-nav.module.css';

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled])';

/** Session-aware call-to-action cluster, shared by desktop and mobile. */
function NavActions({ mobile = false }: { mobile?: boolean }) {
  const { status } = useAuth();

  if (status === 'authenticated') {
    return (
      <ButtonLink href="/tickets" size={mobile ? 'md' : 'sm'}>
        Open app
      </ButtonLink>
    );
  }

  return (
    <>
      <ButtonLink href="/login" variant="ghost" size={mobile ? 'md' : 'sm'}>
        Sign in
      </ButtonLink>
      <ButtonLink href="/login" size={mobile ? 'md' : 'sm'}>
        Explore the platform
      </ButtonLink>
    </>
  );
}

export function PublicNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close the panel whenever the route changes (a menu link was used).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While open: move focus into the panel and lock body scroll.
  useEffect(() => {
    if (!open) {
      return;
    }
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function closeAndRefocus() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  /**
   * Keyboard behavior for the open overlay: Escape dismisses, Tab cycles
   * through the visible focusables of the header + panel (the overlay
   * covers everything else, so focus must not escape behind it).
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!open) {
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeAndRefocus();
      return;
    }
    if (event.key !== 'Tab' || !rootRef.current) {
      return;
    }
    const focusables = [
      ...rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ].filter((element) => element.offsetParent !== null);
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <header ref={rootRef} className={styles.header} onKeyDown={handleKeyDown}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark}>
          HelpDesk&nbsp;<span>AI</span>
        </Link>

        <nav className={styles.desktopNav} aria-label="Main">
          {PUBLIC_NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                pathname === link.href
                  ? `${styles.navLink} ${styles.navLinkActive}`
                  : styles.navLink
              }
              aria-current={pathname === link.href ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className={styles.actions}>
          <ThemeToggle />
          <div className={styles.desktopActions}>
            <NavActions />
          </div>
          <button
            ref={toggleRef}
            type="button"
            className={styles.menuToggle}
            aria-expanded={open}
            aria-controls="public-mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => (open ? closeAndRefocus() : setOpen(true))}
          >
            {open ? <XIcon size={20} /> : <MenuIcon size={20} />}
          </button>
        </div>
      </div>

      {open ? (
        <div
          id="public-mobile-menu"
          ref={panelRef}
          className={styles.mobilePanel}
        >
          <nav className={styles.mobileNav} aria-label="Main menu">
            {PUBLIC_NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  pathname === link.href
                    ? `${styles.mobileLink} ${styles.mobileLinkActive}`
                    : styles.mobileLink
                }
                aria-current={pathname === link.href ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className={styles.mobileActions}>
            <NavActions mobile />
          </div>
        </div>
      ) : null}
    </header>
  );
}
