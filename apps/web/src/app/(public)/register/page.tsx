'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { useAuth } from '../../../components/auth-context';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { FormError, Input } from '../../../components/ui/field';
import { registerRequest } from '../../../lib/session';
import styles from './page.module.css';

/** Mirrors auth-service's rule. No composition requirements, by design. */
const MIN_PASSWORD_LENGTH = 12;

function RegisterForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // A person who arrived from an invitation should land back on redemption
  // rather than on an empty account page. The code itself is NEVER in the
  // URL — only the fact that they were going there.
  const joining = searchParams.get('next') === 'join';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const next: { email?: string; password?: string } = {};
    if (!email.includes('@')) {
      next.email = 'Enter a valid email address.';
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    if (!validate()) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Two calls, not one. The BFF deliberately does not sign anyone in on
      // registration, so the sequence lives here — which also means a login
      // failure after a successful registration is visible and recoverable
      // rather than hidden inside one response.
      await registerRequest(email, password);
      await login(email, password);
      router.push(joining ? '/join' : '/tickets');
    } catch (registerError) {
      setError(
        registerError instanceof Error
          ? registerError.message
          : 'Could not create the account',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <Card className={styles.card}>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.subtitle}>
          {joining
            ? 'Create an account first — then you can use your invitation code.'
            : 'You choose your own password. Nobody else ever sees it.'}
        </p>
        <form
          onSubmit={handleSubmit}
          aria-label="register form"
          className={styles.form}
        >
          <Input
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            error={errors.email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            error={errors.password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className={styles.hint}>
            At least {MIN_PASSWORD_LENGTH} characters. Length is what matters —
            there are no character rules.
          </p>
          {error ? <FormError>{error}</FormError> : null}
          <Button type="submit" loading={submitting}>
            Create account
          </Button>
        </form>
        <p className={styles.alt}>
          Already have an account?{' '}
          <Link href="/login" className={styles.link}>
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}

/**
 * useSearchParams opts a route into client-side rendering, so Next requires a
 * Suspense boundary for it to prerender the shell. The fallback is the same
 * card without the invitation-aware subtitle — the form itself never depends
 * on the parameter.
 */
export default function RegisterPage() {
  return (
    <Suspense fallback={<div className={styles.wrap} />}>
      <RegisterForm />
    </Suspense>
  );
}
