'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../../components/auth-context';
import { Button, ButtonLink } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { ConfirmAction } from '../../../components/ui/confirm-action';
import { CopyButton } from '../../../components/ui/copy-button';
import { EmptyState } from '../../../components/ui/empty-state';
import { FormError, Input, Select } from '../../../components/ui/field';
import {
  LockIcon,
  MailIcon,
  UserPlusIcon,
  UsersIcon,
} from '../../../components/ui/icons';
import { Skeleton } from '../../../components/ui/skeleton';
import { can, PERMISSIONS } from '../../../lib/permissions';
import {
  listGrantableRoleTemplates,
  issueInvitation,
  listBranches,
  listInvitations,
  listPeople,
  revokeInvitation,
  roleLabel,
  type DirectoryPerson,
  type Invitation,
  type IssuedInvitation,
  type OrganizationBranch,
} from '../../../lib/people';
import { MemberAdmin, statusLabel } from './member-admin';
import styles from './page.module.css';

function RowSkeletons({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className={styles.list}>
      {[0, 1, 2].map((index) => (
        <Card key={index} className={styles.row}>
          <div className={styles.rowMain}>
            <Skeleton width="45%" height="1rem" />
            <Skeleton width="12rem" height="0.75rem" />
          </div>
          <Skeleton width="7rem" height="1.375rem" />
        </Card>
      ))}
    </div>
  );
}

/** pending + expired reads as expired; the row keeps its stored status. */
function invitationState(invitation: Invitation): string {
  if (invitation.status === 'pending') {
    return invitation.expired ? 'Expired' : 'Pending';
  }
  return invitation.status === 'accepted' ? 'Accepted' : 'Revoked';
}

export default function PeoplePage() {
  const { status, session } = useAuth();
  const canRead = can(session, PERMISSIONS.PEOPLE_READ);
  const canInvite = can(session, PERMISSIONS.PEOPLE_INVITE);
  // One key per control, never one "can manage people" boolean: the approved
  // matrix separates them and so does the server (ADR 0021).
  const canAssignRoles = can(session, PERMISSIONS.PEOPLE_ASSIGN_ROLES);
  const canSuspend = can(session, PERMISSIONS.PEOPLE_SUSPEND);
  const canManageBranches = can(session, PERMISSIONS.BRANCHES_MANAGE_MEMBERS);
  const canAdminister = canAssignRoles || canSuspend || canManageBranches;

  const [people, setPeople] = useState<DirectoryPerson[] | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [branches, setBranches] = useState<OrganizationBranch[] | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [template, setTemplate] = useState<string>('requester');
  // What the SERVER says this caller may grant, rather than a list this file
  // used to hardcode. Empty until it loads, and an empty answer is real.
  const [grantableRoles, setGrantableRoles] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const accessToken = session?.accessToken;

  const loadPeople = useCallback(async () => {
    if (!accessToken || !canRead) {
      return;
    }
    try {
      // 'all' only for somebody who can act on them. Suspended and removed
      // people are otherwise noise on a screen that could do nothing about
      // them — and the server's default is what every picker relies on.
      setPeople(
        await listPeople(accessToken, canAdminister ? 'all' : undefined),
      );
      setPeopleError(null);
    } catch (error) {
      setPeopleError(error instanceof Error ? error.message : 'Load failed');
    }
  }, [accessToken, canRead, canAdminister]);

  const loadBranches = useCallback(async () => {
    if (!accessToken || !canManageBranches) {
      return;
    }
    try {
      setBranches(await listBranches(accessToken));
    } catch {
      // A refused or failed branch listing must not take the directory down
      // with it: the editor simply does not appear.
      setBranches(null);
    }
  }, [accessToken, canManageBranches]);

  const loadInvitations = useCallback(async () => {
    if (!accessToken || !canInvite) {
      return;
    }
    try {
      setInvitations(await listInvitations(accessToken));
      setInvitationsError(null);
    } catch (error) {
      // A 403 lands here when the permission snapshot is stale — the person
      // was demoted within the last access-token lifetime. Show the message
      // rather than an impossible state (ADR 0020).
      setInvitationsError(
        error instanceof Error ? error.message : 'Load failed',
      );
    }
  }, [accessToken, canInvite]);

  const loadGrantableRoles = useCallback(async () => {
    if (!accessToken || (!canInvite && !canAssignRoles)) {
      return;
    }
    try {
      const templates = await listGrantableRoleTemplates(accessToken);
      setGrantableRoles(templates);
      // The default has to be something the server would accept. 'requester'
      // is the narrowest template and is in every non-empty answer, but
      // reading the list is what makes that true rather than assumed.
      if (templates.length > 0) {
        setTemplate((current) =>
          templates.includes(current)
            ? current
            : templates[templates.length - 1],
        );
      }
    } catch {
      // The forms simply do not offer a role rather than offering a guess.
      setGrantableRoles([]);
    }
  }, [accessToken, canInvite, canAssignRoles]);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    void loadPeople();
    void loadInvitations();
    void loadBranches();
    void loadGrantableRoles();
  }, [status, loadPeople, loadInvitations, loadBranches, loadGrantableRoles]);

  async function submitInvite(event: FormEvent) {
    event.preventDefault();
    if (submitting || !accessToken) {
      return;
    }
    if (!email.trim()) {
      setFormError('Enter the email address to invite.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const invitation = await issueInvitation(accessToken, {
        inviteeEmail: email.trim(),
        roleTemplate: template,
      });
      // Held in state and nowhere else: this response is the only place the
      // code exists, and no endpoint can return it again.
      setIssued(invitation);
      setEmail('');
      setNote(`Invitation created for ${invitation.inviteeEmail}.`);
      await loadInvitations();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not invite');
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(invitation: Invitation) {
    if (!accessToken) {
      return;
    }
    setRevoking(invitation.id);
    try {
      await revokeInvitation(accessToken, invitation.id);
      setNote(`Invitation for ${invitation.inviteeEmail} revoked.`);
      await loadInvitations();
    } catch (error) {
      setInvitationsError(
        error instanceof Error ? error.message : 'Could not revoke',
      );
    } finally {
      setRevoking(null);
    }
  }

  if (status === 'loading') {
    return <RowSkeletons label="Loading people" />;
  }

  if (status === 'anonymous' || !session) {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You are not signed in"
        hint="Sign in to see the people in your organization."
        action={<ButtonLink href="/login">Sign in</ButtonLink>}
      />
    );
  }

  // A token with no organization is a real, ordinary state — every account
  // between registering and redeeming an invitation is in it (ADR 0014).
  if (!session.organizationId) {
    return (
      <EmptyState
        icon={<UsersIcon size={22} />}
        title="You are not part of an organization yet"
        hint="If somebody gave you an invitation code, you can use it to join."
        action={<ButtonLink href="/join">Use an invitation code</ButtonLink>}
      />
    );
  }

  if (!canRead && !canInvite) {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You do not manage people here"
        hint="Ask an administrator of your organization if you need access to the directory."
      />
    );
  }

  return (
    <div className={styles.page}>
      <p className="sr-only" role="status">
        {note}
      </p>

      <header className={styles.header}>
        <h1 className={styles.title}>People</h1>
        {people ? (
          <span className={styles.count}>
            {people.length} {people.length === 1 ? 'member' : 'members'}
          </span>
        ) : null}
      </header>

      {canInvite ? (
        <Card className={styles.inviteCard}>
          <h2 className={styles.sectionTitle}>
            <UserPlusIcon size={17} />
            Invite someone
          </h2>
          <form
            className={styles.inviteForm}
            aria-label="invite form"
            onSubmit={(event) => void submitInvite(event)}
          >
            <Input
              id="invitee-email"
              label="Email address"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="colleague@company.com"
            />
            <Select
              id="invitee-role"
              label="Role"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
            >
              {grantableRoles.map((value) => (
                <option key={value} value={value}>
                  {roleLabel(value)}
                </option>
              ))}
            </Select>
            {formError ? <FormError>{formError}</FormError> : null}
            <Button
              type="submit"
              loading={submitting}
              className={styles.submit}
            >
              Create invitation
            </Button>
          </form>

          {issued ? (
            <div
              className={styles.codePanel}
              role="group"
              aria-label="Invitation code"
            >
              <p className={styles.codeIntro}>
                Give this code to <strong>{issued.inviteeEmail}</strong>. It
                works once and expires on{' '}
                {new Date(issued.expiresAt).toLocaleDateString()}.
              </p>
              <code className={styles.code}>{issued.code}</code>
              <div className={styles.codeActions}>
                <CopyButton value={issued.code} label="Copy code" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIssued(null)}
                >
                  Done
                </Button>
              </div>
              {/* The platform sends nothing. Saying so is not a disclaimer,
                  it is the instruction — nobody is going to receive an
                  email, and an interface that implied otherwise would leave
                  the invitee waiting for one. */}
              <p className={styles.codeWarning}>
                <MailIcon size={14} />
                We did not send this anywhere. Pass it on yourself, and keep it
                private — anyone holding it can join as{' '}
                {roleLabel(issued.roleTemplate)}. You will not be able to see it
                again.
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {canInvite ? (
        <section className={styles.section} aria-label="Invitations">
          <h2 className={styles.sectionTitle}>Invitations</h2>
          {invitationsError ? (
            <FormError>{invitationsError}</FormError>
          ) : invitations === null ? (
            <RowSkeletons label="Loading invitations" />
          ) : invitations.length === 0 ? (
            <p className={styles.empty}>No invitations yet.</p>
          ) : (
            <ul className={styles.list}>
              {invitations.map((invitation) => (
                <li key={invitation.id}>
                  <Card className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>
                        {invitation.inviteeEmail}
                      </span>
                      <span className={styles.meta}>
                        {roleLabel(invitation.roleTemplate)} ·{' '}
                        {invitationState(invitation)}
                      </span>
                    </div>
                    {invitation.status === 'pending' ? (
                      <ConfirmAction
                        label="Revoke"
                        question="Revoke it?"
                        confirmLabel="Revoke"
                        describedSubject={`the invitation for ${invitation.inviteeEmail}`}
                        loading={revoking === invitation.id}
                        onConfirm={() => void revoke(invitation)}
                      />
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {canRead ? (
        <section className={styles.section} aria-label="Members">
          <h2 className={styles.sectionTitle}>Members</h2>
          {peopleError ? (
            <FormError>{peopleError}</FormError>
          ) : people === null ? (
            <RowSkeletons label="Loading members" />
          ) : people.length === 0 ? (
            <p className={styles.empty}>
              Nobody else is here yet. Invitations you create will show above
              until they are used.
            </p>
          ) : (
            <ul className={styles.list}>
              {people.map((person) => {
                const memberStatus = person.status ?? 'active';
                const isSelf = person.userId === session.user.id;
                return (
                  <li key={person.userId}>
                    <Card className={styles.memberCard}>
                      <div className={styles.row}>
                        <div className={styles.rowMain}>
                          <span className={styles.rowTitle}>
                            {person.preferredName ?? person.displayName}
                          </span>
                          <span className={styles.meta}>{person.email}</span>
                        </div>
                        <div className={styles.rowActions}>
                          {memberStatus !== 'active' ? (
                            <span className={styles.statusTag}>
                              {statusLabel(memberStatus)}
                            </span>
                          ) : null}
                          <span className={styles.role}>
                            {roleLabel(person.roleTemplate)}
                          </span>
                          {/* Your own membership has no controls, because the
                              server refuses to administer it: that rule is
                              what guarantees an organization keeps at least
                              one administrator (ADR 0021). */}
                          {canAdminister && !isSelf ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-expanded={managing === person.userId}
                              onClick={() =>
                                setManaging(
                                  managing === person.userId
                                    ? null
                                    : person.userId,
                                )
                              }
                            >
                              {managing === person.userId ? 'Close' : 'Manage'}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {managing === person.userId ? (
                        <MemberAdmin
                          accessToken={session.accessToken}
                          person={person}
                          canAssignRoles={canAssignRoles}
                          canSuspend={canSuspend}
                          canManageBranches={canManageBranches}
                          branches={branches}
                          grantableRoles={grantableRoles}
                          onChanged={(message) => {
                            setNote(message);
                            void loadPeople();
                          }}
                        />
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
