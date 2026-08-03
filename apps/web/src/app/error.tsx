'use client';

import { useEffect } from 'react';
import { Mark } from '../components/brand/mark';
import styles from './fallback.module.css';

/**
 * The crash surface. A React error boundary has to be a client component,
 * and Next resets the segment by calling `reset()` — so the honest primary
 * action is "try again", not a link away.
 *
 * WHAT THIS DELIBERATELY DOES NOT SHOW. `error.message` never reaches the
 * screen. In production Next already redacts it to a generic string, but in
 * development it is the real message, and a screen that shows a stack trace
 * in one environment and not the other teaches people to distrust it. The
 * `digest` is shown instead: it is the id that ties this screen to the
 * server log, which is the thing somebody reporting the problem can usefully
 * quote.
 *
 * It also says nothing about the cause. Every domain refusal in this product
 * renders as a real message inside the page that raised it (ADR 0020); if a
 * person reaches this screen, the product genuinely does not know what
 * happened, and guessing would be worse than saying so.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The one place the real error survives: the browser console, where a
    // developer can see it and a visitor never looks.
    console.error(error);
  }, [error]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Mark size={40} />
        <h1 className={styles.title}>Something went wrong here</h1>
        <p className={styles.body}>
          This screen failed to load. Your work is not affected — nothing was
          saved or changed by the failure.
        </p>
        <div className={styles.actions}>
          <button type="button" onClick={reset} className={styles.primary}>
            Try again
          </button>
          <a href="/" className={styles.secondary}>
            Go to the home page
          </a>
        </div>
        {error.digest ? (
          <p className={styles.digest}>
            If you report this, include: <code>{error.digest}</code>
          </p>
        ) : null}
      </div>
    </main>
  );
}
