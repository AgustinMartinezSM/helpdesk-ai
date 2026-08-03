'use client';

import Link from 'next/link';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { can, PERMISSIONS } from '../lib/permissions';
import { ThemeToggle } from './theme-toggle';
import { ButtonLink } from './ui/button';
import { LogOutIcon, UserIcon } from './ui/icons';
import { Skeleton } from './ui/skeleton';
import styles from './app-shell.module.css';

function SessionArea() {
  const { status, session, logout } = useAuth();
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) {
        menu.open = false;
      }
    }
    document.addEventListener('click', closeOnOutsideClick);
    return () => document.removeEventListener('click', closeOnOutsideClick);
  }, []);

  if (status === 'loading') {
    return <Skeleton width="2.125rem" height="2.125rem" />;
  }

  if (status === 'anonymous' || !session) {
    return (
      <ButtonLink href="/login" variant="secondary" size="sm">
        Sign in
      </ButtonLink>
    );
  }

  const closeMenu = () => {
    if (menuRef.current) {
      menuRef.current.open = false;
    }
  };

  // <details> has no built-in Escape dismissal (only <dialog> does).
  const closeOnEscape = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key === 'Escape' && menuRef.current?.open) {
      closeMenu();
      menuRef.current.querySelector('summary')?.focus();
    }
  };

  return (
    <details ref={menuRef} className={styles.menu} onKeyDown={closeOnEscape}>
      <summary className={styles.avatar} aria-label="Account menu">
        {session.user.email.charAt(0).toUpperCase()}
      </summary>
      <div className={styles.dropdown}>
        <p className={styles.menuEmail}>{session.user.email}</p>
        <Link href="/account" className={styles.menuItem} onClick={closeMenu}>
          <UserIcon size={14} />
          Account
        </Link>
        <button
          type="button"
          className={`${styles.menuItem} ${styles.signOut}`}
          onClick={() => {
            closeMenu();
            void logout();
          }}
        >
          <LogOutIcon size={14} />
          Sign out
        </button>
      </div>
    </details>
  );
}

/**
 * Navigation entries, gated on what the session says the person may do.
 *
 * Hiding is not authorization (ADR 0015 rule 2): every destination refuses on
 * its own, and a link that appears for someone whose permissions changed in
 * the last few minutes leads to a page that explains itself rather than to
 * data they should not see.
 */
function AppNav() {
  const { session } = useAuth();
  // An array from the third entry on: two hardcoded links were fine, three
  // is the point where adding a fourth should not mean editing markup.
  const entries = [
    { href: '/tickets', label: 'Tickets', visible: true },
    {
      href: '/people',
      label: 'People',
      visible:
        can(session, PERMISSIONS.PEOPLE_READ) ||
        can(session, PERMISSIONS.PEOPLE_INVITE),
    },
    {
      href: '/organization',
      label: 'Organization',
      // Two keys, because the screen has two sections and a service desk
      // manager runs the support teams without administering branches.
      visible:
        can(session, PERMISSIONS.BRANCHES_READ) ||
        can(session, PERMISSIONS.TEAMS_MANAGE),
    },
  ];

  return (
    <nav className={styles.nav} aria-label="Main">
      {entries
        .filter((entry) => entry.visible)
        .map((entry) => (
          <Link key={entry.href} href={entry.href} className={styles.navLink}>
            {entry.label}
          </Link>
        ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      {/* The public layout has had both of these since 7.6; the authenticated
          shell had neither, and a second section is the moment to stop the
          two diverging. */}
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.wordmark}>
            HelpDesk&nbsp;<span>AI</span>
          </Link>
          <AppNav />
          <div className={styles.actions}>
            <ThemeToggle />
            <SessionArea />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        HelpDesk AI — AI-assisted support
      </footer>
    </div>
  );
}
