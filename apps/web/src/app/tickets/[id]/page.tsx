'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../../components/auth-context';
import {
  addComment,
  changeStatus,
  getTicket,
  type TicketDetails,
  type TicketStatus,
} from '../../../lib/tickets';
import styles from '../../page.module.css';

/** Legal next statuses, mirrored from the domain for button rendering only. */
const NEXT_STATUSES: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['resolved', 'open'],
  resolved: ['closed', 'open'],
  closed: [],
};

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const { status, session } = useAuth();
  const [details, setDetails] = useState<TicketDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const isStaff = Boolean(
    session &&
    (session.user.roles.includes('agent') ||
      session.user.roles.includes('admin')),
  );

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    try {
      setDetails(await getTicket(session.accessToken, params.id));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Load failed');
    }
  }, [session, params.id]);

  useEffect(() => {
    if (status === 'authenticated') {
      void load();
    }
  }, [status, load]);

  if (status === 'loading') {
    return (
      <main className={styles.page}>
        <p>Restoring your session…</p>
      </main>
    );
  }

  if (status === 'anonymous') {
    return (
      <main className={styles.page}>
        <p>
          You are not signed in. <Link href="/login">Sign in</Link>
        </p>
      </main>
    );
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!session || !comment.trim()) {
      return;
    }
    try {
      await addComment(session.accessToken, params.id, comment.trim());
      setComment('');
      await load();
    } catch (commentError) {
      setError(
        commentError instanceof Error ? commentError.message : 'Comment failed',
      );
    }
  }

  async function moveTo(next: TicketStatus) {
    if (!session) {
      return;
    }
    try {
      await changeStatus(session.accessToken, params.id, next);
      await load();
    } catch (statusError) {
      setError(
        statusError instanceof Error ? statusError.message : 'Update failed',
      );
    }
  }

  const ticket = details?.ticket;
  // Requesters get exactly one lifecycle action: closing their resolved ticket.
  const requesterCanClose =
    !isStaff &&
    ticket !== undefined &&
    session !== null &&
    ticket.requesterId === session.user.id &&
    ticket.status === 'resolved';

  return (
    <main className={styles.page}>
      <p>
        <Link href="/tickets">← Tickets</Link>
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {!details && !error ? <p>Loading ticket…</p> : null}
      {details && ticket ? (
        <>
          <h1>{ticket.title}</h1>
          <p>
            Status: <strong>{ticket.status}</strong> · Priority:{' '}
            {ticket.priority}
            {ticket.assigneeId ? ' · Assigned' : ' · Unassigned'}
          </p>
          <p>{ticket.description}</p>

          {isStaff ? (
            <p>
              {NEXT_STATUSES[ticket.status].map((next) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => void moveTo(next)}
                >
                  Move to {next}
                </button>
              ))}
            </p>
          ) : null}
          {requesterCanClose ? (
            <p>
              <button type="button" onClick={() => void moveTo('closed')}>
                Confirm fix and close
              </button>
            </p>
          ) : null}

          <h2>Comments</h2>
          {details.comments.length === 0 ? <p>No comments yet.</p> : null}
          <ul>
            {details.comments.map((entry) => (
              <li key={entry.id}>
                {entry.internal ? <em>[internal] </em> : null}
                {entry.body}
              </li>
            ))}
          </ul>
          <form onSubmit={submitComment} aria-label="add comment form">
            <label htmlFor="comment">Add a comment</label>
            <textarea
              id="comment"
              required
              maxLength={5000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
            <button type="submit">Comment</button>
          </form>

          <h2>History</h2>
          <ul>
            {details.history.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`}>
                {entry.action}
                {entry.detail ? `: ${entry.detail}` : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
