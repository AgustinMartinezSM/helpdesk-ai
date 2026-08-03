import type { Metadata } from 'next';
import Link from 'next/link';
import { Mark } from '../components/brand/mark';
import styles from './fallback.module.css';

export const metadata: Metadata = {
  title: 'Page not found',
};

/**
 * The 404. It lives at the ROOT rather than inside a route group, because a
 * URL that matches no route matches no group either — a not-found.tsx under
 * `(public)` would never render for the addresses that need it most.
 *
 * That is also why it carries the mark instead of a shell: neither the
 * public nav nor the authenticated shell can be assumed here. AppShell needs
 * a session, and mounting it would make a mistyped URL depend on the BFF
 * being up.
 *
 * The copy states the consequence and offers the two doors that always
 * exist. It does not apologise, and it does not guess what the person meant.
 */
export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Mark size={40} />
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>That page is not here</h1>
        <p className={styles.body}>
          The address may have changed, or it may never have existed. Nothing is
          broken and nothing was lost.
        </p>
        <div className={styles.actions}>
          <Link href="/" className={styles.primary}>
            Go to the home page
          </Link>
          <Link href="/tickets" className={styles.secondary}>
            Go to your requests
          </Link>
        </div>
      </div>
    </main>
  );
}
