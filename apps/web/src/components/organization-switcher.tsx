'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import {
  listMyOrganizations,
  type SelectableOrganization,
} from '../lib/organization';
import styles from './app-shell.module.css';

/**
 * Which organization you are working in, and how to change it (Sprint 10.6,
 * ADR 0025).
 *
 * IT RENDERS NOTHING FOR ALMOST EVERYBODY, and that is the point. Somebody who
 * belongs to one organization has no choice to make, so showing them a picker
 * with one entry would be a control that does nothing — the shell stays exactly
 * as it was for every account that has ever existed until now. It appears only
 * when there is a second place to go.
 *
 * The list comes from the server, not from the session: a token says which
 * organization it is FOR, never which others exist, and inventing a claim that
 * listed them would grow every token in the platform to answer a question one
 * screen asks.
 *
 * Nothing is optimistic. The label does not change until the exchange resolves,
 * because the exchange can refuse — and if it does, the person is still where
 * they were and the screen has to agree.
 */
export function OrganizationSwitcher() {
  const { status, session, switchOrganization } = useAuth();
  const [organizations, setOrganizations] = useState<
    SelectableOrganization[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const accessToken = session?.accessToken;
  const organizationId = session?.organizationId ?? null;

  const load = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    try {
      setOrganizations(await listMyOrganizations(accessToken));
    } catch {
      // Not fatal to the shell: failing to load the list means no switcher,
      // never a header that cannot render.
      setOrganizations(null);
    }
  }, [accessToken]);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    void load();
  }, [status, load]);

  if (status !== 'authenticated' || !organizations || !organizationId) {
    return null;
  }

  const current = organizations.find(
    (entry) => entry.organizationId === organizationId,
  );

  // One organization is not a choice. Zero means the person is in the holding
  // pen or belongs nowhere, and neither is somewhere a picker helps.
  if (organizations.length < 2) {
    return null;
  }

  async function choose(next: string) {
    if (switching || next === organizationId) {
      return;
    }
    setSwitching(true);
    setError(null);
    try {
      await switchOrganization(next);
    } catch (failure) {
      // A 404 means the organization stopped being available while this
      // header was open. Shown rather than swallowed: the person is still
      // where they were, and the list is re-read so it stops offering it.
      setError(failure instanceof Error ? failure.message : 'Could not switch');
      await load();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className={styles.switcher}>
      <label className="sr-only" htmlFor="organization-switcher">
        Organization
      </label>
      <select
        id="organization-switcher"
        className={styles.switcherSelect}
        value={organizationId}
        disabled={switching}
        onChange={(event) => void choose(event.target.value)}
      >
        {/* The current organization is always an option even if the list has
            gone stale, so the control never shows somebody somewhere they are
            not. */}
        {current ? null : (
          <option value={organizationId}>Current organization</option>
        )}
        {organizations.map((entry) => (
          <option key={entry.organizationId} value={entry.organizationId}>
            {entry.name}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className={styles.switcherError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
