'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../../components/auth-context';
import { Button, ButtonLink } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { FormError, Input, Textarea } from '../../../components/ui/field';
import { LockIcon } from '../../../components/ui/icons';
import { PriorityDot } from '../../../components/ui/status';
import { createTicket, type TicketPriority } from '../../../lib/tickets';
import styles from './page.module.css';

const PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];

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
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You are not signed in"
        hint="Sign in to open a new support ticket."
        action={<ButtonLink href="/login">Sign in</ButtonLink>}
      />
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
    <div className={styles.wrap}>
      <h1 className={styles.title}>New ticket</h1>
      <Card className={styles.card}>
        <form
          onSubmit={handleSubmit}
          aria-label="new ticket form"
          className={styles.form}
        >
          <Input
            id="title"
            label="Title"
            required
            minLength={3}
            maxLength={200}
            placeholder="Summarize the problem"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <Textarea
            id="description"
            label="Description"
            required
            maxLength={5000}
            placeholder="What happened? What did you expect instead?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <fieldset className={styles.priorityGroup}>
            <legend className={styles.legend}>Priority</legend>
            <div className={styles.priorityOptions}>
              {PRIORITIES.map((option) => (
                <label
                  key={option}
                  className={
                    priority === option
                      ? `${styles.priorityPill} ${styles.priorityActive}`
                      : styles.priorityPill
                  }
                >
                  <input
                    type="radio"
                    name="priority"
                    value={option}
                    checked={priority === option}
                    onChange={() => setPriority(option)}
                    className="sr-only"
                  />
                  <PriorityDot priority={option} />
                </label>
              ))}
            </div>
          </fieldset>

          {error ? <FormError>{error}</FormError> : null}

          <Button type="submit" loading={submitting} className={styles.submit}>
            Create ticket
          </Button>
        </form>
      </Card>
    </div>
  );
}
