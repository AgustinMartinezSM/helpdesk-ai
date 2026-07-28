'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '../../components/auth-context';
import { listTickets, type Ticket } from '../../lib/tickets';
import styles from '../page.module.css';

export default function TicketsPage() {
  const { status, session } = useAuth();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !session) {
      return;
    }
    let cancelled = false;
    listTickets(session.accessToken)
      .then((page) => {
        if (!cancelled) {
          setTickets(page.items);
        }
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setError(loadError.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, session]);

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
        <h1>Tickets</h1>
        <p>
          You are not signed in. <Link href="/login">Sign in</Link>
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1>Tickets</h1>
      <p>
        <Link href="/tickets/new">New ticket</Link> ·{' '}
        <Link href="/account">Account</Link>
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {tickets === null && !error ? <p>Loading tickets…</p> : null}
      {tickets?.length === 0 ? <p>No tickets yet.</p> : null}
      {tickets && tickets.length > 0 ? (
        <ul>
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Link href={`/tickets/${ticket.id}`}>{ticket.title}</Link>{' '}
              <span>
                [{ticket.status}] · {ticket.priority}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
