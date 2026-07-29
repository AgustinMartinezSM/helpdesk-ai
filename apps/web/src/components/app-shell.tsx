'use client';

import Link from 'next/link';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useAuth } from './auth-context';
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

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.wordmark}>
            HelpDesk&nbsp;<span>AI</span>
          </Link>
          <nav className={styles.nav} aria-label="Main">
            <Link href="/tickets" className={styles.navLink}>
              Tickets
            </Link>
          </nav>
          <div className={styles.actions}>
            <ThemeToggle />
            <SessionArea />
          </div>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        HelpDesk AI — AI-assisted support
      </footer>
    </div>
  );
}
