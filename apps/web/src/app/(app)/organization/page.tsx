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
import { BranchPanel } from './branch-panel';
import styles from './page.module.css';

export default function OrganizationPage() {
  const { status, session } = useAuth();
  const canRead = can(session, PERMISSIONS.BRANCHES_READ);
  const canCreate = can(session, PERMISSIONS.BRANCHES_CREATE);
  const canUpdate = can(session, PERMISSIONS.BRANCHES_UPDATE);

  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    void load();
  }, [status, load]);

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

  if (!canRead) {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You do not manage this organization"
        hint="Ask an administrator if you need to see or change its branches."
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
                          {branch.status === 'archived' ? 'Reopen' : 'Archive'}
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
    </div>
  );
}
