'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../../components/auth-context';
import { createTicket, type TicketPriority } from '../../../lib/tickets';
import styles from '../../page.module.css';

export default function NewTicketPage() {
  const { status, session } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'anonymous') {
    return (
      <main className={styles.page}>
        <p>
          You are not signed in. <Link href="/login">Sign in</Link>
        </p>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!session) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const ticket = await createTicket(session.accessToken, {
        title,
        description,
        priority,
      });
      router.push(`/tickets/${ticket.id}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Creation failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <h1>New ticket</h1>
      <form onSubmit={handleSubmit} aria-label="new ticket form">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          required
          minLength={3}
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          required
          maxLength={5000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <label htmlFor="priority">Priority</label>
        <select
          id="priority"
          value={priority}
          onChange={(event) =>
            setPriority(event.target.value as TicketPriority)
          }
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>

        {error ? <p role="alert">{error}</p> : null}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create ticket'}
        </button>
      </form>
    </main>
  );
}
