'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../../components/auth-context';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { FormError, Input } from '../../../components/ui/field';
import styles from './page.module.css';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // The submit button is aria-disabled while loading (still focusable),
    // so implicit form submission must be guarded against re-entry.
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.push('/account');
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : 'Login failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <Card className={styles.card}>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>Welcome back — use your work account.</p>
        <form
          onSubmit={handleSubmit}
          aria-label="login form"
          className={styles.form}
        >
          <Input
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error ? <FormError>{error}</FormError> : null}

          <Button type="submit" loading={submitting} className={styles.submit}>
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
