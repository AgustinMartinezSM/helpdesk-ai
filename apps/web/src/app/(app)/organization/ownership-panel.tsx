'use client';

import { useState } from 'react';
import { Card } from '../../../components/ui/card';
import { ConfirmAction } from '../../../components/ui/confirm-action';
import { FormError, Select } from '../../../components/ui/field';
import { Skeleton } from '../../../components/ui/skeleton';
import { roleLabel, type DirectoryPerson } from '../../../lib/people';
import { transferOwnership } from '../../../lib/organization';
import styles from './page.module.css';

export interface OwnershipPanelProps {
  accessToken: string;
  organizationName: string;
  /**
   * The active directory, or null when it could not be read. Null is rendered
   * as a stated problem rather than as an empty picker: "nobody works here" and
   * "the list did not load" must not look the same on a screen whose next
   * control gives the organization away.
   */
  people: DirectoryPerson[] | null;
  /** The signed-in person, so the current owner is not offered to themselves. */
  viewerUserId: string;
  /**
   * Runs after the backend confirms. The page refreshes the session and
   * re-reads the organization from it — this panel never assumes the transfer
   * happened.
   */
  onTransferred: (message: string) => Promise<void> | void;
}

/**
 * Handing the organization to somebody else.
 *
 * Rendered only when the server said `viewerIsOwner`, which is read fresh
 * rather than taken from the session's permission snapshot — an owner and an
 * administrator carry identical permissions, so the snapshot could not tell
 * them apart even when it is current.
 *
 * NOTHING IS OPTIMISTIC HERE. The list is not re-ordered, the labels do not
 * change and no state is assumed until the request resolves; on success the
 * page refreshes the session, because the person who just confirmed is no
 * longer the owner and their token still says they are.
 */
export function OwnershipPanel({
  accessToken,
  organizationName,
  people,
  viewerUserId,
  onTransferred,
}: OwnershipPanelProps) {
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Active members other than the person reading the screen — who, on this
  // panel, is by definition the current owner. The server enforces all of
  // this again; the filter exists so nobody is offered a choice that will be
  // refused (Sprint 9.14's lesson about pickers that offer what they cannot
  // deliver).
  const candidates = (people ?? []).filter(
    (person) => person.userId !== viewerUserId,
  );
  const chosen = candidates.find((person) => person.userId === selected);

  async function confirm() {
    if (working || !chosen) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await transferOwnership(accessToken, chosen.userId);
      setSelected('');
      await onTransferred(
        `${chosen.displayName} owns ${organizationName} now. You are an administrator.`,
      );
    } catch (failure) {
      // A 409 means the ownership moved while this screen was open, and a 403
      // means it already had. Both are shown as the server worded them: a
      // friendlier rewrite here would flatten the difference between "try
      // again" and "this is no longer yours".
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not transfer ownership',
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card className={styles.createCard}>
      <h2 className={styles.sectionTitle}>Ownership</h2>
      <p className={styles.hint}>
        You own {organizationName}. The owner is the one person who can hand the
        organization to somebody else — nobody can change or remove the
        owner&apos;s membership, including another administrator.
      </p>

      {people === null ? (
        <FormError>
          The list of people could not be loaded, so ownership cannot be
          transferred here right now.
        </FormError>
      ) : people.length === 0 ? (
        <div role="status" aria-label="Loading people">
          <Skeleton width="60%" height="1rem" />
        </div>
      ) : candidates.length === 0 ? (
        <p className={styles.empty}>
          There is nobody else here yet. Invite a colleague first, and you can
          hand the organization to them once they have joined.
        </p>
      ) : (
        <div className={styles.createForm}>
          <Select
            id="ownership-successor"
            label="Hand it to"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a member…</option>
            {candidates.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.displayName} — {roleLabel(person.roleTemplate)}
              </option>
            ))}
          </Select>

          {error ? <FormError>{error}</FormError> : null}

          <p className={styles.hint}>
            They become the owner immediately, and you become an administrator —
            you stay in {organizationName} and keep every permission you have
            now. Only they will be able to transfer it after that.
          </p>

          {chosen ? (
            <div className={styles.rowActions}>
              <ConfirmAction
                label="Transfer ownership"
                question={`Give ${chosen.displayName} ownership of ${organizationName}?`}
                confirmLabel="Yes, transfer it"
                describedSubject={`Transfer ownership of ${organizationName} to ${chosen.displayName}`}
                loading={working}
                size="md"
                onConfirm={() => void confirm()}
              />
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
