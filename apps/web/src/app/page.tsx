'use client';

import { useAuth } from '../components/auth-context';
import { ButtonLink } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import styles from './page.module.css';

export default function Index() {
  const { status } = useAuth();

  return (
    <div className={styles.hero}>
      <div className={styles.glow} aria-hidden="true" />
      <h1 className={styles.title}>
        HelpDesk <span>AI</span>
      </h1>
      <p className={styles.tagline}>
        Calm, fast support — with AI-assisted workflows behind every ticket.
      </p>
      <div className={styles.cta}>
        {status === 'loading' ? (
          // Placeholder while the silent refresh resolves — flashing
          // "Sign in" at an authenticated user reads as a lost session.
          <Skeleton width="9rem" height="2.5rem" />
        ) : status === 'authenticated' ? (
          <ButtonLink href="/tickets">Go to tickets</ButtonLink>
        ) : (
          <ButtonLink href="/login">Sign in</ButtonLink>
        )}
      </div>
    </div>
  );
}
