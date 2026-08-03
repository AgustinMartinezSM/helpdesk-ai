'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { FormError } from '../../../components/ui/field';
import { Skeleton } from '../../../components/ui/skeleton';
import type { AssignableCandidate } from '../../../lib/people';
import type { Branch } from '../../../lib/organization';
import {
  getTeam,
  setTeamMembers,
  setTeamScope,
  type SupportTeam,
  type SupportTeamDetail,
} from '../../../lib/teams';
import styles from './page.module.css';

export interface TeamPanelProps {
  accessToken: string;
  team: SupportTeam;
  /** Null when the branch listing was refused or failed — the coverage
   * editor then explains itself instead of offering an empty set. */
  branches: Branch[] | null;
  /** Same, for the candidate list behind the member editor. */
  people: AssignableCandidate[] | null;
  onChanged: (message: string) => void;
}

/**
 * Who is in one support team, and which branches it covers.
 *
 * Both editors send the WHOLE desired set rather than a delta, because that
 * is what the server accepts: repeating a request converges, and a lost
 * addition cannot leave the two sides disagreeing about who resolves what.
 *
 * The branch editor's empty state is the important one. No branch selected
 * means the team serves the ENTIRE organization — that is the central-team
 * case and the default a team is born in, not a misconfiguration. The screen
 * says which of the two it is in words rather than leaving an empty list to
 * be read as "serves nothing".
 */
export function TeamPanel({
  accessToken,
  team,
  branches,
  people,
  onChanged,
}: TeamPanelProps) {
  const [detail, setDetail] = useState<SupportTeamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [scope, setScope] = useState<string[]>([]);

  const { teamId } = team;

  const load = useCallback(async () => {
    try {
      const loaded = await getTeam(accessToken, teamId);
      setDetail(loaded);
      setMembers(loaded.memberUserIds);
      setScope(loaded.branchIds);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Load failed');
    }
  }, [accessToken, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((entry) => entry !== value)
      : [...list, value];
  }

  const membersChanged =
    detail !== null &&
    (members.length !== detail.memberUserIds.length ||
      members.some((id) => !detail.memberUserIds.includes(id)));
  const scopeChanged =
    detail !== null &&
    (scope.length !== detail.branchIds.length ||
      scope.some((id) => !detail.branchIds.includes(id)));

  if (detail === null) {
    return (
      <div className={styles.panel}>
        {error ? (
          <FormError>{error}</FormError>
        ) : (
          <div role="status" aria-label={`Loading ${team.name}`}>
            <Skeleton width="60%" height="1rem" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {team.status === 'archived' ? (
        // Archiving does not clear anything, so reopening restores the group
        // as it was — the no-cascade stance branches took in Sprint 9.11.
        <p className={styles.hint}>
          This team is archived. Its people and its coverage are kept exactly as
          they are, and reopening it restores all of them — but while it is
          archived nobody sees its tickets and no ticket can be routed to it.
        </p>
      ) : null}

      <section
        aria-label={`People in ${team.name}`}
        className={styles.panelSection}
      >
        <h3 className={styles.panelTitle}>People</h3>
        {/* The line that keeps the two concepts apart on a screen that shows
            both. Somebody can work in Electronics at Store 12 and resolve
            nothing; being here is what makes them a resolver (ADR 0022). */}
        <p className={styles.hint}>
          These are the people who resolve this team&rsquo;s tickets. This is
          separate from any department: working in a department says where
          somebody works, not what they fix.
        </p>
        {people === null ? (
          <p className={styles.empty}>
            The list of people could not be loaded, so members cannot be changed
            here.
          </p>
        ) : people.length === 0 ? (
          <p className={styles.empty}>Nobody to add yet.</p>
        ) : (
          <>
            <ul className={styles.itemList}>
              {people.map((person) => (
                <li key={person.userId} className={styles.item}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={members.includes(person.userId)}
                      onChange={() =>
                        setMembers(toggle(members, person.userId))
                      }
                    />
                    <span>{person.name}</span>
                  </label>
                  <span className={styles.meta}>{person.email}</span>
                </li>
              ))}
            </ul>
            <div className={styles.inlineForm}>
              <Button
                type="button"
                size="sm"
                loading={busy}
                disabled={!membersChanged}
                onClick={() =>
                  void run(async () => {
                    await setTeamMembers(accessToken, teamId, members);
                    onChanged(`${team.name} members saved.`);
                  })
                }
              >
                Save people
              </Button>
              {/* The claim is minted with the token, so the effect is not
                  instant and the screen should not imply that it is
                  (ADR 0014). */}
              <span className={styles.hint}>
                Somebody removed here keeps seeing this team&rsquo;s tickets
                until their session renews.
              </span>
            </div>
          </>
        )}
      </section>

      <section
        aria-label={`Coverage of ${team.name}`}
        className={styles.panelSection}
      >
        <h3 className={styles.panelTitle}>Coverage</h3>
        <p className={styles.hint}>
          {scope.length === 0
            ? 'No branch selected, so this team serves the whole organization — the central-team case.'
            : `This team serves only the ${scope.length === 1 ? 'branch' : `${scope.length} branches`} selected below. A ticket filed anywhere else cannot be routed to it, and neither can a ticket filed under no branch at all.`}
        </p>
        {branches === null ? (
          <p className={styles.empty}>
            Branches could not be loaded, so coverage cannot be changed here.
          </p>
        ) : branches.length === 0 ? (
          <p className={styles.empty}>
            There are no branches yet, so this team serves the whole
            organization.
          </p>
        ) : (
          <>
            <ul className={styles.itemList}>
              {branches.map((branch) => (
                <li key={branch.branchId} className={styles.item}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={scope.includes(branch.branchId)}
                      onChange={() => setScope(toggle(scope, branch.branchId))}
                    />
                    <span>
                      {branch.status === 'archived'
                        ? `${branch.name} (archived)`
                        : branch.name}
                    </span>
                  </label>
                  <span className={styles.meta}>{branch.code}</span>
                </li>
              ))}
            </ul>
            <div className={styles.inlineForm}>
              <Button
                type="button"
                size="sm"
                loading={busy}
                disabled={!scopeChanged}
                onClick={() =>
                  void run(async () => {
                    await setTeamScope(accessToken, teamId, scope);
                    onChanged(
                      scope.length === 0
                        ? `${team.name} now serves the whole organization.`
                        : `${team.name} coverage saved.`,
                    );
                  })
                }
              >
                Save coverage
              </Button>
              {scope.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setScope([])}
                >
                  Serve the whole organization
                </Button>
              ) : null}
            </div>
          </>
        )}
      </section>

      {error ? <FormError>{error}</FormError> : null}
    </div>
  );
}
