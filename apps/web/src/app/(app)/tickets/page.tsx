'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../components/auth-context';
import { ButtonLink } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { FormError } from '../../../components/ui/field';
import {
  ChevronRightIcon,
  LockIcon,
  PlusIcon,
  TicketIcon,
} from '../../../components/ui/icons';
import { Skeleton } from '../../../components/ui/skeleton';
import { PriorityDot, StatusBadge } from '../../../components/ui/status';
import { relativeTime } from '../../../lib/format';
import { can, PERMISSIONS } from '../../../lib/permissions';
import { listMyTeams, type SupportTeam } from '../../../lib/teams';
import {
  listTickets,
  type Ticket,
  type TicketStatus,
} from '../../../lib/tickets';
import styles from './page.module.css';

type Filter = TicketStatus | 'all';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

function RowSkeletons() {
  return (
    <div role="status" aria-label="Loading tickets" className={styles.list}>
      {[0, 1, 2, 3, 4].map((index) => (
        <Card key={index} className={styles.row}>
          <div className={styles.rowMain}>
            <Skeleton width="55%" height="1rem" />
            <Skeleton width="7rem" height="0.75rem" />
          </div>
          <Skeleton width="9rem" height="1.375rem" />
        </Card>
      ))}
    </div>
  );
}

export default function TicketsPage() {
  const { status, session } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [team, setTeam] = useState<string>('all');
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<SupportTeam[]>([]);

  const canReadTeams = can(session, PERMISSIONS.TICKETS_READ_TEAM);
  const accessToken = session?.accessToken;

  useEffect(() => {
    if (status !== 'authenticated' || !accessToken || !canReadTeams) {
      return;
    }
    let cancelled = false;
    // The caller's OWN teams, which is what the server would intersect the
    // filter with anyway. Nobody's ticket list should offer a team whose
    // work they cannot see.
    listMyTeams(accessToken)
      .then((mine) => {
        if (!cancelled) {
          setTeams(mine);
        }
      })
      .catch(() => {
        // The team filter simply does not appear; the listing is unaffected.
        if (!cancelled) {
          setTeams([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, accessToken, canReadTeams]);

  useEffect(() => {
    if (status !== 'authenticated' || !session) {
      return;
    }
    let cancelled = false;
    setTickets(null);
    setTotal(null); // a stale count would describe the previous filter
    setError(null);
    listTickets(session.accessToken, {
      ...(filter === 'all' ? {} : { status: filter }),
      ...(team === 'all' ? {} : { assignedTeamId: team }),
    })
      .then((page) => {
        if (!cancelled) {
          setTickets(page.items);
          setTotal(page.total);
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
  }, [status, session, filter, team]);

  if (status === 'loading') {
    return <RowSkeletons />;
  }

  if (status === 'anonymous') {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You are not signed in"
        hint="Sign in to see and manage your support tickets."
        action={<ButtonLink href="/login">Sign in</ButtonLink>}
      />
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Tickets</h1>
          {total !== null ? (
            <p className={styles.count}>{total} total</p>
          ) : null}
        </div>
        <ButtonLink href="/tickets/new">
          <PlusIcon size={16} />
          New ticket
        </ButtonLink>
      </header>

      <div
        className={styles.filters}
        role="group"
        aria-label="Filter by status"
      >
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              filter === option.value
                ? `${styles.filter} ${styles.filterActive}`
                : styles.filter
            }
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Only when the person is in more than nothing: an organization that
          has configured no teams, or somebody who belongs to none, is not
          asked about a concept that does not apply to them (ADR 0016).

          Labelled "Show", not "Filter", and that word is load-bearing
          (Sprint 9.14). Choosing a team narrows to that team's work AND
          keeps the caller's own requests, because the server's team scope is
          a visibility rule rather than a filter — `assignedTeamId IN (…) OR
          requesterId = me`, deliberate since Sprint 9.5 so a manager never
          loses sight of a request they filed themselves. Sprint 9.13 called
          this control a filter, which promised a narrowing it does not
          perform. */}
      {teams.length > 0 ? (
        <div className={styles.filters} role="group" aria-label="Show tickets">
          <button
            type="button"
            className={
              team === 'all'
                ? `${styles.filter} ${styles.filterActive}`
                : styles.filter
            }
            aria-pressed={team === 'all'}
            onClick={() => setTeam('all')}
          >
            All teams
          </button>
          {teams.map((option) => (
            <button
              key={option.teamId}
              type="button"
              className={
                team === option.teamId
                  ? `${styles.filter} ${styles.filterActive}`
                  : styles.filter
              }
              aria-pressed={team === option.teamId}
              onClick={() => setTeam(option.teamId)}
            >
              {option.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* Said rather than left to be discovered: a request you filed yourself
          stays visible whichever team is selected. */}
      {teams.length > 0 && team !== 'all' ? (
        <p className={styles.scopeNote}>
          Showing this team&rsquo;s tickets, plus any request you opened
          yourself.
        </p>
      ) : null}

      {error ? <FormError>{error}</FormError> : null}

      {tickets === null && !error ? <RowSkeletons /> : null}

      {tickets?.length === 0 ? (
        filter === 'all' ? (
          <EmptyState
            icon={<TicketIcon size={22} />}
            title="No tickets yet"
            hint="When something needs attention, open a ticket and the team will pick it up."
            action={
              <ButtonLink href="/tickets/new">
                <PlusIcon size={16} />
                Create your first ticket
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            icon={<TicketIcon size={22} />}
            title="No matching tickets"
            hint="Try another status filter."
          />
        )
      ) : null}

      {tickets && tickets.length > 0 ? (
        <ul className={styles.list}>
          {tickets.map((ticket) => {
            const created = relativeTime(ticket.createdAt);
            return (
              <li key={ticket.id}>
                <Link href={`/tickets/${ticket.id}`} className={styles.rowLink}>
                  <Card interactive className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{ticket.title}</span>
                      {created ? (
                        <span className={styles.rowMeta}>
                          Created {created}
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.rowBadges}>
                      <StatusBadge status={ticket.status} />
                      <PriorityDot priority={ticket.priority} />
                      <ChevronRightIcon size={16} className={styles.chevron} />
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
