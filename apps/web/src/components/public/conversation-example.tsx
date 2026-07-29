import type { ReactNode } from 'react';
import { StatusBadge } from '../ui/status';
import type { TicketStatus } from '../../lib/tickets';
import styles from './conversation-example.module.css';

type Entry =
  | { kind: 'message'; from: 'user' | 'support'; author: string; body: string }
  | { kind: 'status'; status: TicketStatus; label: string };

const THREAD: Entry[] = [
  {
    kind: 'message',
    from: 'user',
    author: 'Marina, accounting',
    body: 'My account appears to be locked and I need to upload today’s payments.',
  },
  { kind: 'status', status: 'open', label: 'Open — waiting for the team' },
  {
    kind: 'message',
    from: 'support',
    author: 'Support',
    body: 'Could you confirm the exact message shown on screen?',
  },
  {
    kind: 'message',
    from: 'user',
    author: 'Marina, accounting',
    body: '“Your account has been temporarily locked.”',
  },
  {
    kind: 'status',
    status: 'in_progress',
    label: 'In progress — someone is on it',
  },
  {
    kind: 'message',
    from: 'support',
    author: 'Support',
    body: 'The account was unlocked and access was restored. Please try again and tell me if anything still fails.',
  },
  { kind: 'status', status: 'resolved', label: 'Resolved — fix confirmed' },
];

/**
 * A worked example of one request from start to finish. Everything it
 * shows exists in the product today: a title, a status, a thread and a
 * permanent history.
 */
export function ConversationExample(): ReactNode {
  return (
    <figure className={styles.example}>
      <div className={styles.card}>
        <header className={styles.head}>
          <p className={styles.requestLabel}>Request</p>
          <h3 className={styles.requestTitle}>
            I cannot access the invoicing system
          </h3>
          <p className={styles.requestMeta}>
            Opened by Marina in accounting · one place, one thread
          </p>
        </header>

        <ol className={styles.thread} role="list">
          {THREAD.map((entry, index) =>
            entry.kind === 'message' ? (
              <li
                key={index}
                className={
                  entry.from === 'user'
                    ? styles.message
                    : `${styles.message} ${styles.fromSupport}`
                }
              >
                <p className={styles.author}>{entry.author}</p>
                <p className={styles.body}>{entry.body}</p>
              </li>
            ) : (
              <li key={index} className={styles.statusRow}>
                <StatusBadge status={entry.status} />
                <span className={styles.statusLabel}>{entry.label}</span>
              </li>
            ),
          )}
        </ol>
      </div>
      <figcaption className={styles.caption}>
        Nothing here lives in a private chat: the question, the answer, every
        status change and who did what stay attached to the request.
      </figcaption>
    </figure>
  );
}
