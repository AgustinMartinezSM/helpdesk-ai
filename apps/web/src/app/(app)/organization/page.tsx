'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../../components/auth-context';
import { Button, ButtonLink } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { FormError, Input } from '../../../components/ui/field';
import { LayersIcon, LockIcon, PlusIcon } from '../../../components/ui/icons';
import { Skeleton } from '../../../components/ui/skeleton';
import { can, PERMISSIONS } from '../../../lib/permissions';
import {
  createBranch,
  listBranches,
  updateBranch,
  type Branch,
} from '../../../lib/organization';
import { listPeople, type DirectoryPerson } from '../../../lib/people';
import {
  createTeam,
  listTeams,
  updateTeam,
  type SupportTeam,
} from '../../../lib/teams';
import { BranchPanel } from './branch-panel';
import { TeamPanel } from './team-panel';
import styles from './page.module.css';

export default function OrganizationPage() {
  const { status, session } = useAuth();
  const canRead = can(session, PERMISSIONS.BRANCHES_READ);
  const canCreate = can(session, PERMISSIONS.BRANCHES_CREATE);
  const canUpdate = can(session, PERMISSIONS.BRANCHES_UPDATE);
  // One key per section rather than one "can set up the organization"
  // boolean: the matrix separates them, and a service desk manager runs the
  // teams without touching the branches (People screen's pattern since 9.9).
  const canManageTeams = can(session, PERMISSIONS.TEAMS_MANAGE);

  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [teams, setTeams] = useState<SupportTeam[] | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [people, setPeople] = useState<DirectoryPerson[] | null>(null);
  const [teamCode, setTeamCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamFormError, setTeamFormError] = useState<string | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);

  const accessToken = session?.accessToken;

  const load = useCallback(async () => {
    if (!accessToken || !canRead) {
      return;
    }
    try {
      setBranches(await listBranches(accessToken));
      setError(null);
    } catch (failure) {
      // A 403 lands here when the permission snapshot is stale (ADR 0020).
      setError(failure instanceof Error ? failure.message : 'Load failed');
    }
  }, [accessToken, canRead]);

  const loadTeams = useCallback(async () => {
    if (!accessToken || !canManageTeams) {
      return;
    }
    try {
      setTeams(await listTeams(accessToken));
      setTeamsError(null);
    } catch (failure) {
      setTeamsError(failure instanceof Error ? failure.message : 'Load failed');
    }
  }, [accessToken, canManageTeams]);

  const loadPeople = useCallback(async () => {
    if (!accessToken || !canManageTeams) {
      return;
    }
    try {
      // The server's default — active members only — is exactly right here: a
      // suspended colleague should not be offered as somebody who resolves
      // tickets.
      setPeople(await listPeople(accessToken));
    } catch {
      // A refused directory must not take the teams section down with it; the
      // member editor says so instead of showing an empty set as if nobody
      // worked here.
      setPeople(null);
    }
  }, [accessToken, canManageTeams]);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    void load();
    void loadTeams();
    void loadPeople();
  }, [status, load, loadTeams, loadPeople]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !accessToken) {
      return;
    }
    if (!code.trim() || !name.trim()) {
      setFormError('A branch needs a code and a name.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await createBranch(accessToken, {
        code: code.trim(),
        name: name.trim(),
      });
      setCode('');
      setName('');
      setNote(`${created.name} registered.`);
      await load();
    } catch (failure) {
      setFormError(
        failure instanceof Error ? failure.message : 'Could not register it',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTeam(event: FormEvent) {
    event.preventDefault();
    if (creatingTeam || !accessToken) {
      return;
    }
    if (!teamCode.trim() || !teamName.trim()) {
      setTeamFormError('A support team needs a code and a name.');
      return;
    }
    setCreatingTeam(true);
    setTeamFormError(null);
    try {
      const created = await createTeam(accessToken, {
        code: teamCode.trim(),
        name: teamName.trim(),
      });
      setTeamCode('');
      setTeamName('');
      setNote(`${created.name} created. It serves the whole organization.`);
      await loadTeams();
    } catch (failure) {
      setTeamFormError(
        failure instanceof Error ? failure.message : 'Could not create it',
      );
    } finally {
      setCreatingTeam(false);
    }
  }

  async function setTeamStatus(
    team: SupportTeam,
    teamStatus: 'active' | 'archived',
  ) {
    if (!accessToken) {
      return;
    }
    try {
      await updateTeam(accessToken, team.teamId, { status: teamStatus });
      setNote(
        teamStatus === 'archived'
          ? `${team.name} archived. Its people stop seeing its tickets when their sessions renew.`
          : `${team.name} is working again.`,
      );
      await loadTeams();
    } catch (failure) {
      setTeamsError(
        failure instanceof Error ? failure.message : 'Could not save',
      );
    }
  }

  async function setStatus(branch: Branch, status: 'active' | 'archived') {
    if (!accessToken) {
      return;
    }
    try {
      await updateBranch(accessToken, branch.branchId, { status });
      setNote(
        status === 'archived'
          ? `${branch.name} archived.`
          : `${branch.name} is open again.`,
      );
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save');
    }
  }

  if (status === 'loading') {
    return (
      <div role="status" aria-label="Loading branches" className={styles.list}>
        {[0, 1].map((index) => (
          <Card key={index} className={styles.row}>
            <Skeleton width="40%" height="1rem" />
          </Card>
        ))}
      </div>
    );
  }

  if (status === 'anonymous' || !session) {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You are not signed in"
        hint="Sign in to set up your organization."
        action={<ButtonLink href="/login">Sign in</ButtonLink>}
      />
    );
  }

  // Ordinary and expected between registering and redeeming an invitation
  // (ADR 0014): this page must not assume an organization exists.
  if (!session.organizationId) {
    return (
      <EmptyState
        icon={<LayersIcon size={22} />}
        title="You are not part of an organization yet"
        hint="If somebody gave you an invitation code, you can use it to join."
        action={<ButtonLink href="/join">Use an invitation code</ButtonLink>}
      />
    );
  }

  // Either key opens the page, and each section then gates itself: a service
  // desk manager runs the support teams without administering branches.
  if (!canRead && !canManageTeams) {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You do not manage this organization"
        hint="Ask an administrator if you need to see or change its branches and support teams."
      />
    );
  }

  return (
    <div className={styles.page}>
      <p className="sr-only" role="status">
        {note}
      </p>

      <header className={styles.header}>
        <h1 className={styles.title}>Organization</h1>
        {branches ? (
          <span className={styles.count}>
            {branches.length} {branches.length === 1 ? 'branch' : 'branches'}
          </span>
        ) : null}
      </header>

      {canCreate ? (
        <Card className={styles.createCard}>
          <h2 className={styles.sectionTitle}>
            <PlusIcon size={17} />
            Add a branch
          </h2>
          <form
            className={styles.createForm}
            aria-label="branch form"
            onSubmit={(event) => void submit(event)}
          >
            <Input
              id="branch-code"
              label="Code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="store-12"
            />
            <Input
              id="branch-name"
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Store 12"
            />
            {formError ? <FormError>{formError}</FormError> : null}
            {/* Said before it is chosen, not after it cannot be changed. */}
            <p className={styles.hint}>
              The code identifies this branch everywhere and cannot be changed
              later. The name can.
            </p>
            <Button
              type="submit"
              loading={submitting}
              className={styles.submit}
            >
              Register branch
            </Button>
          </form>
        </Card>
      ) : null}

      {canRead ? (
        <section className={styles.section} aria-label="Branches">
          <h2 className={styles.sectionTitle}>Branches</h2>
          {error ? (
            <FormError>{error}</FormError>
          ) : branches === null ? (
            <div role="status" aria-label="Loading branches">
              <Skeleton width="60%" height="1rem" />
            </div>
          ) : branches.length === 0 ? (
            <p className={styles.empty}>
              No branches yet. Register the places your organization works from,
              and people can be assigned to them.
            </p>
          ) : (
            <ul className={styles.list}>
              {branches.map((branch) => (
                <li key={branch.branchId}>
                  <Card className={styles.branchCard}>
                    <div className={styles.row}>
                      <div className={styles.rowMain}>
                        <span className={styles.rowTitle}>{branch.name}</span>
                        <span className={styles.meta}>
                          {branch.code}
                          {branch.timezone ? ` · ${branch.timezone}` : ''}
                        </span>
                      </div>
                      <div className={styles.rowActions}>
                        {branch.status === 'archived' ? (
                          <span className={styles.statusTag}>Archived</span>
                        ) : null}
                        {canUpdate ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void setStatus(
                                branch,
                                branch.status === 'archived'
                                  ? 'active'
                                  : 'archived',
                              )
                            }
                          >
                            {branch.status === 'archived'
                              ? 'Reopen'
                              : 'Archive'}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={open === branch.branchId}
                          onClick={() =>
                            setOpen(
                              open === branch.branchId ? null : branch.branchId,
                            )
                          }
                        >
                          {open === branch.branchId ? 'Close' : 'Open'}
                        </Button>
                      </div>
                    </div>
                    {open === branch.branchId ? (
                      <BranchPanel
                        accessToken={session.accessToken}
                        branch={branch}
                        canUpdate={canUpdate}
                        onChanged={setNote}
                      />
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {canManageTeams ? (
        <section className={styles.section} aria-label="Support teams">
          <h2 className={styles.sectionTitle}>Support teams</h2>
          {/* The distinction ADR 0022 exists for, on the one screen that
              shows both words. Anybody reading this page has just seen
              departments inside a branch; without this line the two read as
              the same idea with different names. */}
          <p className={styles.hint}>
            A support team is the group that resolves tickets. It belongs to the
            organization rather than to a branch, so one team can serve every
            branch, several, or just one. This is not a department: a department
            says where somebody works, a support team says what they fix.
          </p>

          <Card className={styles.createCard}>
            <h3 className={styles.panelTitle}>Add a support team</h3>
            <form
              className={styles.createForm}
              aria-label="support team form"
              onSubmit={(event) => void submitTeam(event)}
            >
              <Input
                id="team-code"
                label="Code"
                value={teamCode}
                onChange={(event) => setTeamCode(event.target.value)}
                placeholder="it"
              />
              <Input
                id="team-name"
                label="Name"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="IT support"
              />
              {teamFormError ? <FormError>{teamFormError}</FormError> : null}
              {/* Both facts said before they are chosen, not after neither
                  can be undone by the person who chose. */}
              <p className={styles.hint}>
                The code identifies this team everywhere and cannot be changed
                later. A new team starts serving the whole organization; you can
                narrow it to certain branches afterwards.
              </p>
              <Button
                type="submit"
                loading={creatingTeam}
                className={styles.submit}
              >
                Create support team
              </Button>
            </form>
          </Card>

          {teamsError ? (
            <FormError>{teamsError}</FormError>
          ) : teams === null ? (
            <div role="status" aria-label="Loading support teams">
              <Skeleton width="60%" height="1rem" />
            </div>
          ) : teams.length === 0 ? (
            <p className={styles.empty}>
              No support teams yet. Create one for each group that resolves
              tickets — one central team is enough to start, and it will serve
              every branch.
            </p>
          ) : (
            <ul className={styles.list}>
              {teams.map((team) => (
                <li key={team.teamId}>
                  <Card className={styles.branchCard}>
                    <div className={styles.row}>
                      <div className={styles.rowMain}>
                        <span className={styles.rowTitle}>{team.name}</span>
                        <span className={styles.meta}>{team.code}</span>
                      </div>
                      <div className={styles.rowActions}>
                        {team.status === 'archived' ? (
                          <span className={styles.statusTag}>Archived</span>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void setTeamStatus(
                              team,
                              team.status === 'archived'
                                ? 'active'
                                : 'archived',
                            )
                          }
                        >
                          {team.status === 'archived' ? 'Reopen' : 'Archive'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={openTeam === team.teamId}
                          onClick={() =>
                            setOpenTeam(
                              openTeam === team.teamId ? null : team.teamId,
                            )
                          }
                        >
                          {openTeam === team.teamId ? 'Close' : 'Open'}
                        </Button>
                      </div>
                    </div>
                    {openTeam === team.teamId ? (
                      <TeamPanel
                        accessToken={session.accessToken}
                        team={team}
                        branches={branches}
                        people={people}
                        onChanged={(message) => {
                          setNote(message);
                          void loadTeams();
                        }}
                      />
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
