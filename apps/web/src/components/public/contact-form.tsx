'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { siteConfig } from '../../lib/site-config';
import { Button, ButtonLink } from '../ui/button';
import { Card } from '../ui/card';
import { FormError, Input, Select, Textarea } from '../ui/field';
import { CheckIcon, MailIcon } from '../ui/icons';
import styles from './contact-form.module.css';

const REASONS = [
  'General question',
  'Recruiting or hiring',
  'Technical feedback',
  'Something else',
];

interface FormValues {
  name: string;
  email: string;
  organization: string;
  reason: string;
  subject: string;
  message: string;
}

const EMPTY: FormValues = {
  name: '',
  email: '',
  organization: '',
  reason: REASONS[0],
  subject: '',
  message: '',
};

type Errors = Partial<Record<keyof FormValues, string>>;

function validate(values: FormValues): Errors {
  const errors: Errors = {};
  if (!values.name.trim()) {
    errors.name = 'Please tell me your name.';
  }
  if (!values.email.trim()) {
    errors.email = 'An email address is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = 'That does not look like a valid email address.';
  }
  if (!values.subject.trim()) {
    errors.subject = 'A short subject helps me answer faster.';
  }
  if (!values.message.trim()) {
    errors.message = 'The message itself is the important part.';
  } else if (values.message.trim().length < 20) {
    errors.message = 'A little more detail, please — at least 20 characters.';
  }
  return errors;
}

function buildMailto(values: FormValues): string | null {
  if (!siteConfig.contactEmail) {
    return null;
  }
  const subject = `[HelpDesk AI] ${values.subject}`;
  const body = [
    values.message,
    '',
    '—',
    `From: ${values.name}`,
    values.organization ? `Organization: ${values.organization}` : null,
    `Reason: ${values.reason}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  return `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

/**
 * Honest contact experience (ADR 0008): the form validates and behaves
 * like a real product form, but this demo deliberately has no delivery
 * backend — the success state says so explicitly and offers a mailto
 * handoff instead of pretending an email was sent.
 */
export function ContactForm() {
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<'idle' | 'submitting' | 'submitted'>(
    'idle',
  );
  const submittedValues = useRef<FormValues>(EMPTY);
  const successRef = useRef<HTMLHeadingElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState('');

  // Both transitions unmount the element that holds focus, so focus has to
  // be parked deliberately; the live region is mounted permanently below so
  // screen readers are already watching it when the text arrives.
  useEffect(() => {
    if (state === 'submitted') {
      successRef.current?.focus();
      setAnnouncement(
        'Your message is ready. This demo does not send it to a server.',
      );
    }
  }, [state]);

  function update<K extends keyof FormValues>(key: K, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (state !== 'idle') {
      return; // double-submit protection
    }
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    // No network is involved on purpose; the brief submitting state keeps
    // the interaction honest with how the control behaves elsewhere.
    setState('submitting');
    submittedValues.current = values;
    window.setTimeout(() => setState('submitted'), 350);
  }

  function reset() {
    setValues(EMPTY);
    setErrors({});
    setState('idle');
    setAnnouncement('');
    // The clicked button unmounts with this transition.
    window.requestAnimationFrame(() => firstFieldRef.current?.focus());
  }

  if (state === 'submitted') {
    const mailto = buildMailto(submittedValues.current);
    return (
      <>
        <LiveRegion message={announcement} />
        <Card className={styles.successCard}>
          <div className={styles.success}>
            <span className={styles.successIcon}>
              <CheckIcon size={18} />
            </span>
            <h2 ref={successRef} tabIndex={-1} className={styles.successTitle}>
              Your message is ready
            </h2>
            <p className={styles.successBody}>
              Honest note: this demo does not send messages to a server — there
              is no delivery backend behind this form, by design.
              {mailto
                ? ' Use the button below to open the exact message in your email app and send it for real.'
                : ' Direct contact links are not configured in this environment.'}
            </p>
            <div className={styles.successActions}>
              {mailto ? (
                <ButtonLink href={mailto}>
                  <MailIcon size={15} />
                  Open in your email app
                </ButtonLink>
              ) : null}
              <Button variant="secondary" onClick={reset}>
                Write another message
              </Button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  const errorCount = Object.keys(errors).length;

  return (
    <>
      <LiveRegion message={announcement} />
      <Card className={styles.formCard}>
        <form
          onSubmit={handleSubmit}
          aria-label="contact form"
          noValidate
          className={styles.form}
        >
          <div className={styles.row}>
            <Input
              ref={firstFieldRef}
              id="contact-name"
              label="Name"
              autoComplete="name"
              required
              value={values.name}
              error={errors.name}
              onChange={(event) => update('name', event.target.value)}
            />
            <Input
              id="contact-email"
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={values.email}
              error={errors.email}
              onChange={(event) => update('email', event.target.value)}
            />
          </div>

          <div className={styles.row}>
            <Input
              id="contact-organization"
              label="Organization (optional)"
              autoComplete="organization"
              value={values.organization}
              onChange={(event) => update('organization', event.target.value)}
            />
            <Select
              id="contact-reason"
              label="Reason for contact"
              value={values.reason}
              onChange={(event) => update('reason', event.target.value)}
            >
              {REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </Select>
          </div>

          <Input
            id="contact-subject"
            label="Subject"
            required
            maxLength={120}
            value={values.subject}
            error={errors.subject}
            onChange={(event) => update('subject', event.target.value)}
          />

          <Textarea
            id="contact-message"
            label="Message"
            required
            maxLength={4000}
            placeholder="What would you like to talk about?"
            value={values.message}
            error={errors.message}
            onChange={(event) => update('message', event.target.value)}
          />

          {errorCount > 0 ? (
            <FormError>
              {errorCount === 1
                ? 'One field needs your attention.'
                : `${errorCount} fields need your attention.`}
            </FormError>
          ) : null}

          <div className={styles.submitRow}>
            <Button type="submit" loading={state === 'submitting'}>
              Prepare message
            </Button>
            <p className={styles.demoNote}>
              Demo form — nothing is sent to a server.
            </p>
          </div>
        </form>
      </Card>
    </>
  );
}

/**
 * Permanently mounted live region: a `role="status"` element created in the
 * same commit as its text is usually not announced, so it must already be
 * in the accessibility tree before the message arrives.
 */
function LiveRegion({ message }: { message: string }) {
  return (
    <p className="sr-only" role="status">
      {message}
    </p>
  );
}
