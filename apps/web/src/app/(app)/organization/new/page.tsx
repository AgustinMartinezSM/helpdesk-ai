'use client';

import { useState, type FormEvent } from 'react';
import { useAuth } from '../../../../components/auth-context';
import { Button, ButtonLink } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { EmptyState } from '../../../../components/ui/empty-state';
import { FormError, Input } from '../../../../components/ui/field';
import { CheckIcon, LockIcon } from '../../../../components/ui/icons';
import { createOrganization } from '../../../../lib/organization';
import styles from './page.module.css';

/**
 * Creating an organization — the other half of onboarding, beside `/join`.
 *
 * Somebody who registers lands in the migration's holding pen with nothing
 * they can do. Until Sprint 10.4 the only way out was an invitation from an
 * organization somebody had already made by hand in SQL. This is the way in
 * for the first person.
 *
 * It follows `/join`'s shape deliberately, including the part `/join` had to
 * learn in Sprint 9.9: **the session is refreshed after the write.** The
 * token that created the organization does not carry it, so without the
 * refresh the person owns something they are not yet inside — and every
 * screen would keep refusing them.
 */
export default function NewOrganizationPage() {
  const { status, session, refresh } = useAuth();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // The guard against re-entry, not against a slow network: a second
    // submit would create a second organization and the first would be the
    // one the person keeps.
    if (submitting || !session) {
      return;
    }
    if (!name.trim()) {
      setError('Give the organization a name.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const organization = await createOrganization(session.accessToken, {
        name: name.trim(),
      });
      // Before showing success: the person is not actually inside the
      // organization until the token says so.
      await refresh();
      setCreated({ name: organization.name });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'loading') {
    return null;
  }

  if (status === 'anonymous' || !session) {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You are not signed in"
        hint="Sign in first, then you can create an organization."
        action={<ButtonLink href="/login">Sign in</ButtonLink>}
      />
    );
  }

  if (created) {
    return (
      <div className={styles.wrap}>
        <EmptyState
          icon={<CheckIcon size={22} />}
          title={`${created.name} is ready`}
          hint="You are its owner. Register the branches you work from, then invite the people who work there."
          action={<ButtonLink href="/organization">Set it up</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>Create your organization</h1>
      <p className={styles.lead}>
        Everything in HelpDesk AI belongs to an organization: the people, the
        branches they work from, the support teams that resolve requests. This
        creates yours, and makes you its owner.
      </p>

      <Card className={styles.card}>
        <form onSubmit={submit} className={styles.form} noValidate>
          <Input
            id="organization-name"
            label="Organization name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ferretería Sur"
            maxLength={80}
            autoFocus
          />
          {/* Sprint 10.4 wrote "this name cannot be changed later" here, which
              was true then and is not now. What survives is the smaller,
              accurate half: an internal key is derived from this name at
              creation and stays fixed, so the name people see can move and the
              thing other systems point at cannot. Naming the consequence
              before the choice is the same discipline the branch-code hint
              follows. */}
          <p className={styles.hint}>
            An administrator can change this name later. The internal key
            derived from it now cannot change, so pick something you recognise.
            Nobody else can see the organization until you invite them.
          </p>
          {error ? <FormError>{error}</FormError> : null}
          <div className={styles.actions}>
            <Button type="submit" loading={submitting}>
              Create organization
            </Button>
          </div>
        </form>
      </Card>

      <p className={styles.alternative}>
        Somebody already invited you? <a href="/join">Use your code instead</a>.
      </p>
    </div>
  );
}
