'use client';

import Link from 'next/link';
import { useAuth } from '../../components/auth-context';
import styles from '../page.module.css';

export default function AccountPage() {
  const { status, session, logout } = useAuth();

  if (status === 'loading') {
    return (
      <main className={styles.page}>
        <p>Restoring your session…</p>
      </main>
    );
  }

  if (status === 'anonymous' || !session) {
    return (
      <main className={styles.page}>
        <h1>Account</h1>
        <p>
          You are not signed in. <Link href="/login">Sign in</Link>
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1>Account</h1>
      <p>
        Signed in as <strong>{session.user.email}</strong>
      </p>
      <p>Roles: {session.user.roles.join(', ')}</p>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
    </main>
  );
}
