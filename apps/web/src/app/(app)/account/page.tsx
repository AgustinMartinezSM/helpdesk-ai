'use client';

import { useAuth } from '../../../components/auth-context';
import { globalRoleLabel } from '../../../lib/people';
import { Button, ButtonLink } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { LockIcon, LogOutIcon } from '../../../components/ui/icons';
import { Skeleton } from '../../../components/ui/skeleton';
import styles from './page.module.css';

export default function AccountPage() {
  const { status, session, logout } = useAuth();

  if (status === 'loading') {
    return (
      <div role="status" aria-label="Loading account" className={styles.wrap}>
        <Skeleton width="10rem" height="1.75rem" />
        <Skeleton height="7rem" />
      </div>
    );
  }

  if (status === 'anonymous' || !session) {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You are not signed in"
        hint="Sign in to see your account details."
        action={<ButtonLink href="/login">Sign in</ButtonLink>}
      />
    );
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>Account</h1>
      <Card className={styles.card}>
        <div className={styles.profile}>
          <span className={styles.avatar} aria-hidden="true">
            {session.user.email.charAt(0).toUpperCase()}
          </span>
          <div className={styles.identity}>
            <p className={styles.email}>{session.user.email}</p>
            {/*
              These used to print the raw stored keys — "agent" on the one
              screen where every other screen says "Technician". The label
              map exists precisely so a key never reaches the interface, and
              this was the one place the layer was skipped.

              `session.user.roles` is the legacy role array from the user
              row, kept as display data since Phase 8 removed the `roles`
              claim; it is NOT what authorizes anything. The permissions do,
              which is what the line below says out loud.

              It is `globalRoleLabel`, NOT `roleLabel`, and Sprint 10.8 had to
              find that in a browser. These values are `user`/`agent`/`admin`
              — a different vocabulary from the role TEMPLATES that map knows.
              Only `agent` overlaps, so routing them through the wrong map
              looked fixed while every freshly registered account, which is
              `user`, still printed a raw key.
            */}
            <div className={styles.roles}>
              {session.user.roles.map((role) => (
                <span key={role} className={styles.role}>
                  {globalRoleLabel(role)}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.footerRow}>
          <Button variant="danger" onClick={() => void logout()}>
            <LogOutIcon size={15} />
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
