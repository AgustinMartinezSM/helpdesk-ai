'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useAuth } from '../../../components/auth-context';
import { Button, ButtonLink } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { FormError, Textarea } from '../../../components/ui/field';
import {
  ArrowLeftIcon,
  CheckIcon,
  LockIcon,
  SendIcon,
} from '../../../components/ui/icons';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  PriorityDot,
  StatusBadge,
  STATUS_LABELS,
} from '../../../components/ui/status';
import { formatDateTime, relativeTime } from '../../../lib/format';
import {
  addComment,
  changeStatus,
  getTicket,
  type TicketDetails,
  type TicketStatus,
} from '../../../lib/tickets';
import styles from './page.module.css';

/** Legal next statuses, mirrored from the domain for button rendering only. */
const NEXT_STATUSES: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['resolved', 'open'],
  resolved: ['closed', 'open'],
  closed: [],
};

/** Action label for moving a ticket into each target status. */
const TRANSITION_LABELS: Record<TicketStatus, string> = {
  open: 'Reopen',
  in_progress: 'Start progress',
  resolved: 'Resolve',
  closed: 'Close',
};

/** "status_changed" → "Status changed" for history entries. */
function humanizeAction(action: string): string {
  const text = action.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading ticket" className={styles.loading}>
      <Skeleton width="55%" height="1.75rem" />
      <Skeleton width="16rem" height="1.25rem" />
      <Skeleton height="6rem" />
    </div>
  );
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const { status, session } = useAuth();
  const [details, setDetails] = useState<TicketDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);

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
    return <DetailSkeleton />;
  }

  if (status === 'anonymous') {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You are not signed in"
        hint="Sign in to see this ticket."
        action={<ButtonLink href="/login">Sign in</ButtonLink>}
      />
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
      // The activated button unmounts with the transition — announce the
      // result and park keyboard focus on the ticket title.
      setStatusNote(`Status changed to ${STATUS_LABELS[next]}`);
      titleRef.current?.focus();
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
  const created = ticket ? relativeTime(ticket.createdAt) : '';

  return (
    <div className={styles.page}>
      <Link href="/tickets" className={styles.back}>
        <ArrowLeftIcon size={15} />
        Tickets
      </Link>

      {error ? <FormError>{error}</FormError> : null}
      {!details && !error ? <DetailSkeleton /> : null}
      <p className="sr-only" role="status">
        {statusNote}
      </p>

      {details && ticket ? (
        <>
          <header className={styles.header}>
            <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
              {ticket.title}
            </h1>
            <div className={styles.badges}>
              <StatusBadge status={ticket.status} />
              <PriorityDot priority={ticket.priority} />
              <span className={styles.meta}>
                {ticket.assigneeId ? 'Assigned' : 'Unassigned'}
              </span>
              {created ? (
                <span className={styles.meta}>Created {created}</span>
              ) : null}
            </div>
          </header>

          <Card className={styles.description}>{ticket.description}</Card>

          {isStaff && NEXT_STATUSES[ticket.status].length > 0 ? (
            <div
              className={styles.actions}
              role="group"
              aria-label="Change status"
            >
              {NEXT_STATUSES[ticket.status].map((next) => (
                <Button
                  key={next}
                  variant="secondary"
                  size="sm"
                  onClick={() => void moveTo(next)}
                >
                  {TRANSITION_LABELS[next]}
                </Button>
              ))}
            </div>
          ) : null}
          {requesterCanClose ? (
            <div className={styles.actions}>
              <Button onClick={() => void moveTo('closed')}>
                <CheckIcon size={16} />
                Confirm fix and close
              </Button>
            </div>
          ) : null}

          <section className={styles.section} aria-label="Comments">
            <h2 className={styles.sectionTitle}>Comments</h2>
            {details.comments.length === 0 ? (
              <p className={styles.emptyNote}>No comments yet.</p>
            ) : null}
            {details.comments.length > 0 ? (
              <ul className={styles.comments}>
                {details.comments.map((entry) => {
                  const own = entry.authorId === session?.user.id;
                  const commentClasses = [
                    styles.comment,
                    entry.internal ? styles.internal : '',
                    own && !entry.internal ? styles.own : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const when = relativeTime(entry.createdAt);
                  return (
                    <li key={entry.id}>
                      <Card className={commentClasses}>
                        {entry.internal ? (
                          <p className={styles.internalTag}>
                            <LockIcon size={12} />
                            Internal note
                          </p>
                        ) : null}
                        <p className={styles.commentBody}>{entry.body}</p>
                        {own || when ? (
                          <p className={styles.commentMeta}>
                            {own ? 'You' : null}
                            {own && when ? ' · ' : null}
                            {when || null}
                          </p>
                        ) : null}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <form
              onSubmit={submitComment}
              aria-label="add comment form"
              className={styles.commentForm}
            >
              <Textarea
                id="comment"
                label="Add a comment"
                required
                maxLength={5000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <Button type="submit" className={styles.commentSubmit}>
                <SendIcon size={15} />
                Comment
              </Button>
            </form>
          </section>

          <section className={styles.section} aria-label="History">
            <h2 className={styles.sectionTitle}>History</h2>
            <ol className={styles.timeline}>
              {details.history.map((entry, index) => {
                const when = formatDateTime(entry.createdAt);
                return (
                  <li
                    key={`${entry.createdAt}-${index}`}
                    className={styles.timelineItem}
                  >
                    <span className={styles.timelineDot} aria-hidden="true" />
                    <div className={styles.timelineBody}>
                      <p className={styles.timelineAction}>
                        {humanizeAction(entry.action)}
                        {entry.detail ? (
                          <span className={styles.timelineDetail}>
                            {' '}
                            — {entry.detail}
                          </span>
                        ) : null}
                      </p>
                      {when ? (
                        <p className={styles.timelineTime}>{when}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      ) : null}
    </div>
  );
}
