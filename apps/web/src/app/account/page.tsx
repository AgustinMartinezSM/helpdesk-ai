'use client';

import { useAuth } from '../../components/auth-context';
import { Button, ButtonLink } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { LockIcon, LogOutIcon } from '../../components/ui/icons';
import { Skeleton } from '../../components/ui/skeleton';
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
            <div className={styles.roles}>
              {session.user.roles.map((role) => (
                <span key={role} className={styles.role}>
                  {role}
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
