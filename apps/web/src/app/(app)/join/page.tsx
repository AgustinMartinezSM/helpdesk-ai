'use client';

import { useState, type FormEvent } from 'react';
import { useAuth } from '../../../components/auth-context';
import { Button, ButtonLink } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { FormError, Input } from '../../../components/ui/field';
import { CheckIcon, LockIcon, UsersIcon } from '../../../components/ui/icons';
import {
  acceptInvitation,
  previewInvitation,
  roleLabel,
  type InvitationPreview,
} from '../../../lib/people';
import styles from './page.module.css';

export default function JoinPage() {
  const { status, session, refresh } = useAuth();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [joined, setJoined] = useState<{
    organizationName: string;
    roleTemplate: string;
    membershipCreated: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function check(event: FormEvent) {
    event.preventDefault();
    if (submitting || !session) {
      return;
    }
    if (!code.trim()) {
      setError('Paste the invitation code you were given.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Read before spending. Accepting is irreversible and, without this,
      // the person would learn which organization they joined only after
      // joining it.
      setPreview(await previewInvitation(session.accessToken, code.trim()));
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'Could not read that code',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function confirm() {
    if (submitting || !session || !preview) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const accepted = await acceptInvitation(session.accessToken, code.trim());
      setJoined({
        organizationName: preview.organizationName,
        roleTemplate: accepted.roleTemplate,
        membershipCreated: accepted.membershipCreated,
      });
      setCode('');
      setPreview(null);
      // Accepting does not re-mint the caller's token: it still carries no
      // organization until the session is refreshed. Without this the person
      // would join and then appear to belong nowhere.
      await refresh();
    } catch (acceptError) {
      setError(
        acceptError instanceof Error
          ? acceptError.message
          : 'Could not use that code',
      );
      // The invitation may have been spent or revoked between the preview
      // and now — a successful preview was never a promise.
      setPreview(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'loading') {
    return <div role="status" aria-label="Loading" />;
  }

  if (status === 'anonymous' || !session) {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="Sign in to use your invitation"
        hint="An invitation is redeemed by the person it was addressed to, so you need an account first."
        action={
          <div className={styles.authActions}>
            <ButtonLink href="/register?next=join">
              Create an account
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary">
              Sign in
            </ButtonLink>
          </div>
        }
      />
    );
  }

  if (joined) {
    return (
      <EmptyState
        icon={<CheckIcon size={22} />}
        title={`You are in — ${joined.organizationName}`}
        hint={
          joined.membershipCreated
            ? `You joined as ${roleLabel(joined.roleTemplate)}.`
            : `You already belonged to ${joined.organizationName}, so nothing about your access changed.`
        }
        action={<ButtonLink href="/tickets">Go to requests</ButtonLink>}
      />
    );
  }

  return (
    <div className={styles.wrap}>
      <Card className={styles.card}>
        <h1 className={styles.title}>Join an organization</h1>
        <p className={styles.subtitle}>
          Paste the code an administrator gave you. Nobody emails these — if you
          do not have one, ask the person who invited you.
        </p>

        {preview ? (
          <div className={styles.preview} role="group" aria-label="Invitation">
            <UsersIcon size={20} />
            <p className={styles.previewText}>
              <strong>{preview.organizationName}</strong> invited you to join as{' '}
              <strong>{roleLabel(preview.roleTemplate)}</strong>.
            </p>
            {error ? <FormError>{error}</FormError> : null}
            <div className={styles.previewActions}>
              <Button
                type="button"
                loading={submitting}
                onClick={() => void confirm()}
              >
                Join {preview.organizationName}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => void check(event)}
            aria-label="join form"
            className={styles.form}
          >
            <Input
              id="invitation-code"
              label="Invitation code"
              value={code}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setCode(event.target.value)}
            />
            {error ? <FormError>{error}</FormError> : null}
            <Button type="submit" loading={submitting}>
              Continue
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
