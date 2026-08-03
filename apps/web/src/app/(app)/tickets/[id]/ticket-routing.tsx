'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { FormError, Select } from '../../../../components/ui/field';
import { can, PERMISSIONS } from '../../../../lib/permissions';
import type { BrowserSession } from '../../../../lib/session';
import {
  listMyTeams,
  listTeams,
  type SupportTeam,
} from '../../../../lib/teams';
import { routeTicket } from '../../../../lib/tickets';
import styles from './page.module.css';

export interface TicketRoutingProps {
  session: BrowserSession;
  ticketId: string;
  assignedTeamId: string | null;
  onRouted: (message: string) => void;
}

/**
 * Which support team owns resolving this ticket, and — for whoever may
 * change it — the control that moves it.
 *
 * Two different reads feed the same panel, on purpose:
 *
 * A `routing.manage` holder needs every team the organization has, and gets
 * it from the administration listing, because every template that can route
 * can also administer teams (Sprint 9.13, D4 — a test in
 * organizations-service pins that premise). Somebody who merely holds
 * `tickets.read_team` gets their OWN teams, which is all they need to turn
 * the id on the ticket into a name and all their token entitles them to.
 *
 * Anybody else sees nothing here at all. A requester has no business knowing
 * which internal group is handling their request, and an organization that
 * has configured no teams shows this panel to nobody — it renders only when
 * there is something to say.
 */
export function TicketRouting({
  session,
  ticketId,
  assignedTeamId,
  onRouted,
}: TicketRoutingProps) {
  const canRoute = can(session, PERMISSIONS.ROUTING_MANAGE);
  const canReadTeams = can(session, PERMISSIONS.TICKETS_READ_TEAM);
  // Normalized once: a ticket serialized before this field existed sends no
  // key at all, and "undefined" must read as unrouted rather than as a team
  // whose name could not be found.
  const routedTo = assignedTeamId ?? null;

  const [teams, setTeams] = useState<SupportTeam[] | null>(null);
  const [choice, setChoice] = useState<string>(routedTo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { accessToken } = session;

  const load = useCallback(async () => {
    try {
      setTeams(
        canRoute
          ? await listTeams(accessToken)
          : await listMyTeams(accessToken),
      );
    } catch {
      // A refused or failed listing leaves the panel able to name nothing;
      // it says so below rather than showing a picker with no options.
      setTeams(null);
    }
  }, [accessToken, canRoute]);

  useEffect(() => {
    if (!canRoute && !canReadTeams) {
      return;
    }
    void load();
  }, [canRoute, canReadTeams, load]);

  useEffect(() => {
    setChoice(routedTo ?? '');
  }, [routedTo]);

  if (!canRoute && !canReadTeams) {
    return null;
  }

  const current = teams?.find((team) => team.teamId === routedTo);
  // Nothing to say and nothing to do: an organization with no teams should
  // not be asked about a concept it has not configured (ADR 0016).
  if (!canRoute && (teams === null || teams.length === 0)) {
    return null;
  }

  // Archived teams stay in the administration listing so they can be
  // reopened, but a ticket cannot be routed to one — offering it would
  // produce a refusal the picker could have prevented.
  const routable = (teams ?? []).filter((team) => team.status === 'active');

  async function save(teamId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await routeTicket(accessToken, ticketId, teamId);
      onRouted(
        teamId === null
          ? 'Routing cleared.'
          : `Routed to ${routable.find((team) => team.teamId === teamId)?.name ?? 'the team'}.`,
      );
    } catch (failure) {
      // The server answers one generic 422 for archived, foreign, out of
      // scope and branchless-ticket alike. Render its message; guessing which
      // one it was would put words in its mouth.
      setError(failure instanceof Error ? failure.message : 'Could not route');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={styles.routing}>
      <h2 className={styles.sectionTitle}>Support team</h2>
      <p className={styles.routingCurrent}>
        {routedTo === null
          ? 'Not routed to a team yet.'
          : (current?.name ?? 'Routed to a team you cannot see.')}
      </p>

      {canRoute ? (
        <div className={styles.routingForm}>
          <Select
            id="ticket-team"
            label="Route to"
            value={choice}
            disabled={busy}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">No team</option>
            {routable.map((team) => (
              <option key={team.teamId} value={team.teamId}>
                {team.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            loading={busy}
            disabled={choice === (routedTo ?? '')}
            onClick={() => void save(choice === '' ? null : choice)}
          >
            Save
          </Button>
        </div>
      ) : null}

      {canRoute && routable.length === 0 ? (
        <p className={styles.routingHint}>
          There are no active support teams to route to yet. You can create one
          from the Organization screen.
        </p>
      ) : null}

      {/* Said where the refusal would otherwise be a surprise: a team scoped
          to certain branches cannot take work from anywhere else, and a
          ticket filed under no branch cannot go to a scoped team at all
          (ADR 0022). */}
      {canRoute && routable.length > 0 ? (
        <p className={styles.routingHint}>
          A team that only covers certain branches can take this ticket only if
          it was filed under one of them.
        </p>
      ) : null}

      {error ? <FormError>{error}</FormError> : null}
    </Card>
  );
}
