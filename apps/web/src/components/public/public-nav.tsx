'use client';

import Link from 'next/link';
import { Mark } from '../brand/mark';
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

/**
 * Focusables that are actually reachable: anything inside an `inert`
 * subtree is skipped. The desktop row is marked inert while the mobile
 * panel is open, which keeps this check layout-independent (and therefore
 * testable) instead of relying on `offsetParent`.
 */
function reachableFocusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => element.closest('[inert]') === null,
  );
}

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

  // One CTA, not two pointing at the same route: the app needs the local
  // stack running, so "Sign in" is the honest label for it.
  return (
    <ButtonLink href="/login" size={mobile ? 'md' : 'sm'}>
      Sign in
    </ButtonLink>
  );
}

export function PublicNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close the panel whenever the route changes (a menu link was used).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While open: move focus into the panel, lock body scroll, and make the
  // content behind the modal panel inert for assistive tech and pointers.
  useEffect(() => {
    if (!open) {
      return;
    }
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Floating siblings (Helpi) hide off this flag so nothing overlaps the
    // navigation while it owns the screen.
    document.documentElement.dataset.menuOpen = 'true';
    const behind = [
      document.getElementById('main-content'),
      document.querySelector('footer'),
    ].filter((element): element is HTMLElement => element !== null);
    for (const element of behind) {
      element.inert = true;
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      delete document.documentElement.dataset.menuOpen;
      for (const element of behind) {
        element.inert = false;
      }
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
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
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
    const focusables = reachableFocusables(rootRef.current);
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
    // The panel is a sibling of <header>, never a descendant: the header's
    // backdrop-filter would otherwise become the containing block for a
    // position: fixed panel and collapse it to the header's own height.
    <div ref={rootRef} onKeyDown={handleKeyDown}>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link href="/" className={styles.wordmark}>
            <Mark size={26} />
            <span className={styles.wordmarkText}>
              HelpDesk&nbsp;<span>AI</span>
            </span>
          </Link>

          {/* Hidden by CSS below the desktop breakpoint; marked inert while
              the panel is open so it never joins the focus cycle. */}
          <nav className={styles.desktopNav} aria-label="Main" inert={open}>
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
            <div className={styles.desktopActions} inert={open}>
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
      </header>

      {open ? (
        <div
          id="public-mobile-menu"
          ref={panelRef}
          className={styles.mobilePanel}
          // It behaves as a modal (focus trap + scroll lock), so it must
          // announce itself as one.
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
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
                // Same-route links do not trigger a navigation, so close
                // here too — and restore focus, exactly like Escape.
                onClick={closeAndRefocus}
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
    </div>
  );
}
