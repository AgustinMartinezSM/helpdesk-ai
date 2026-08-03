'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { ConfirmAction } from '../../../components/ui/confirm-action';
import { FormError, Select } from '../../../components/ui/field';
import {
  changeMemberRole,
  changeMemberStatus,
  listMemberBranches,
  roleLabel,
  setMemberBranches,
  type DirectoryPerson,
  type MembershipStatus,
  type OrganizationBranch,
} from '../../../lib/people';
import styles from './page.module.css';

export interface MemberAdminProps {
  accessToken: string;
  person: DirectoryPerson;
  canAssignRoles: boolean;
  canSuspend: boolean;
  canManageBranches: boolean;
  /** Null until the branch listing has loaded, or when it was refused. */
  branches: OrganizationBranch[] | null;
  /**
   * What the SERVER says this caller may grant, loaded once by the page. An
   * empty array is a real answer — somebody who can suspend but not re-role
   * — so the role control renders only when there is something to choose.
   */
  grantableRoles: string[];
  onChanged: (message: string) => void;
}

/**
 * The administration panel for one member: role, membership status, branches.
 *
 * Each control is gated on the key ITS use case checks, not on one "can
 * manage people" boolean — the matrix separates them, and so does the server.
 * Every gate here is cosmetic (ADR 0015 rule 2): the refusals live in
 * organizations-service, and this component renders them, because the
 * session's permission list is a snapshot that can be up to an access-token
 * lifetime out of date (ADR 0020).
 */
export function MemberAdmin({
  accessToken,
  person,
  canAssignRoles,
  canSuspend,
  canManageBranches,
  branches,
  grantableRoles,
  onChanged,
}: MemberAdminProps) {
  const status = person.status ?? 'active';
  const [role, setRole] = useState(person.roleTemplate ?? 'requester');
  const [covered, setCovered] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { userId } = person;

  const loadBranches = useCallback(async () => {
    if (!canManageBranches) {
      return;
    }
    try {
      const current = await listMemberBranches(accessToken, userId);
      setCovered(current.branchIds);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Load failed');
    }
  }, [accessToken, canManageBranches, userId]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (failure) {
      // A 403 lands here when the permission snapshot is stale, and a 404
      // when the row moved. Both are real answers, not impossible states.
      setError(failure instanceof Error ? failure.message : 'Request failed');
    } finally {
      setBusy(null);
    }
  }

  const name = person.preferredName ?? person.displayName;

  return (
    <div className={styles.adminPanel}>
      {canAssignRoles && grantableRoles.length > 0 ? (
        <div className={styles.adminGroup}>
          <Select
            id={`role-${userId}`}
            label="Role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            {grantableRoles.map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            loading={busy === 'role'}
            disabled={role === (person.roleTemplate ?? 'requester')}
            onClick={() =>
              void run('role', async () => {
                await changeMemberRole(accessToken, userId, role);
                onChanged(`${name} is now ${roleLabel(role)}.`);
              })
            }
          >
            Save role
          </Button>
        </div>
      ) : null}

      {canSuspend ? (
        <div className={styles.adminGroup} role="group" aria-label="Membership">
          {status === 'active' ? (
            <ConfirmAction
              label="Suspend"
              question="Suspend them?"
              confirmLabel="Suspend"
              describedSubject={`the membership of ${name}`}
              loading={busy === 'suspended'}
              onConfirm={() =>
                void run('suspended', async () => {
                  await changeMemberStatus(accessToken, userId, 'suspended');
                  onChanged(`${name} is suspended.`);
                })
              }
            />
          ) : null}
          {status === 'suspended' || status === 'deactivated' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={busy === 'active'}
              onClick={() =>
                void run('active', async () => {
                  await changeMemberStatus(accessToken, userId, 'active');
                  onChanged(`${name} is active again.`);
                })
              }
            >
              Reinstate
            </Button>
          ) : null}
          {status !== 'deactivated' ? (
            <ConfirmAction
              label="Remove"
              question="Remove them from the organization?"
              confirmLabel="Remove"
              describedSubject={`${name} from the organization`}
              loading={busy === 'deactivated'}
              onConfirm={() =>
                void run('deactivated', async () => {
                  await changeMemberStatus(accessToken, userId, 'deactivated');
                  onChanged(`${name} was removed from the organization.`);
                })
              }
            />
          ) : null}
          {/* Not a disclaimer: an admin who suspends somebody and watches
              them keep working for a quarter of an hour would reasonably
              think the product is broken. */}
          <p className={styles.adminNote}>
            A membership change applies the next time they sign in or their
            session refreshes — up to fifteen minutes.
          </p>
        </div>
      ) : null}

      {canManageBranches && branches && branches.length > 0 ? (
        <BranchEditor
          branches={branches}
          covered={covered}
          saving={busy === 'branches'}
          onSave={(branchIds) =>
            void run('branches', async () => {
              const saved = await setMemberBranches(
                accessToken,
                userId,
                branchIds,
              );
              setCovered(saved.branchIds);
              onChanged(`Branches updated for ${name}.`);
            })
          }
        />
      ) : null}

      {error ? <FormError>{error}</FormError> : null}
    </div>
  );
}

interface BranchEditorProps {
  branches: OrganizationBranch[];
  covered: string[] | null;
  saving: boolean;
  onSave: (branchIds: string[]) => void;
}

/**
 * The branch set, as checkboxes over one replace request.
 *
 * Archived branches are listed only when the member already covers one.
 * Hiding them outright would drop the edge on the next save — this editor
 * sends the whole desired set, so anything it cannot show, it deletes.
 */
function BranchEditor({
  branches,
  covered,
  saving,
  onSave,
}: BranchEditorProps) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const current = selected ?? covered;

  if (!covered || !current) {
    return null;
  }

  const visible = branches.filter(
    (branch) => branch.status === 'active' || covered.includes(branch.id),
  );
  const dirty =
    current.length !== covered.length ||
    current.some((id) => !covered.includes(id));

  return (
    <div className={styles.adminGroup} role="group" aria-label="Branches">
      <span className={styles.adminLabel}>Branches</span>
      <ul className={styles.branchList}>
        {visible.map((branch) => (
          <li key={branch.id}>
            <label className={styles.branchOption}>
              <input
                type="checkbox"
                checked={current.includes(branch.id)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...current, branch.id]
                      : current.filter((id) => id !== branch.id),
                  )
                }
              />
              <span>
                {branch.name}
                {branch.status === 'archived' ? ' (archived)' : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        size="sm"
        loading={saving}
        disabled={!dirty}
        onClick={() => onSave(current)}
      >
        Save branches
      </Button>
    </div>
  );
}

export function statusLabel(status: MembershipStatus): string {
  if (status === 'suspended') {
    return 'Suspended';
  }
  if (status === 'deactivated') {
    return 'Removed';
  }
  return status === 'invited' ? 'Invited' : 'Active';
}
