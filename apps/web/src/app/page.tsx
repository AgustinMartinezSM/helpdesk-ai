import Link from 'next/link';
import styles from './page.module.css';

export default function Index() {
  return (
    <main className={styles.page}>
      <h1>HelpDesk AI</h1>
      <p>
        Help desk platform with AI-assisted support workflows. Authentication is
        live; ticket management arrives in upcoming sprints.
      </p>
      <p>
        <Link href="/login">Sign in</Link> ·{' '}
        <Link href="/account">Account</Link>
      </p>
    </main>
  );
}
