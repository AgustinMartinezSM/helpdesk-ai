'use client';

import { useState } from 'react';
import { Button, type ButtonSize } from './button';
import styles from './confirm-action.module.css';

export interface ConfirmActionProps {
  /** Resting label, e.g. "Revoke". */
  label: string;
  /** Question shown once armed, e.g. "Revoke this invitation?". */
  question: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Names the SUBJECT for assistive tech, because a page full of identical
   * "Revoke" buttons is unusable otherwise — e.g. "Revoke the invitation for
   * ada@example.com".
   */
  describedSubject: string;
  loading?: boolean;
  size?: ButtonSize;
  onConfirm: () => void;
}

/**
 * A two-step destructive action, inline.
 *
 * Deliberately not a modal. The app has no dialog primitive, and a correct
 * one — focus trap, escape handling, restoring focus, inert background — is
 * its own piece of work; this sprint needs one confirmation, not a dialog
 * system. Arming in place also keeps the row's context on screen, which is
 * what makes "which one am I revoking" answerable without reading the
 * question.
 *
 * The first click NEVER fires the action: a test pins that no request goes
 * out until the second one.
 */
export function ConfirmAction({
  label,
  question,
  confirmLabel = 'Yes, do it',
  cancelLabel = 'Cancel',
  describedSubject,
  loading = false,
  size = 'sm',
  onConfirm,
}: ConfirmActionProps) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size={size}
        aria-label={`${label} — ${describedSubject}`}
        onClick={() => setArmed(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <span className={styles.armed} role="group" aria-label={describedSubject}>
      <span className={styles.question}>{question}</span>
      <Button
        type="button"
        variant="danger"
        size={size}
        loading={loading}
        aria-label={`${confirmLabel} — ${describedSubject}`}
        onClick={() => {
          if (loading) {
            return;
          }
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size={size}
        onClick={() => setArmed(false)}
      >
        {cancelLabel}
      </Button>
    </span>
  );
}
