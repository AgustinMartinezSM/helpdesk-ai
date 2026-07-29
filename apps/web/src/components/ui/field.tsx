'use client';

import {
  useCallback,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircleIcon } from './icons';
import styles from './field.module.css';

export interface FieldProps {
  id: string;
  label: string;
  error?: string | null;
  children: ReactNode;
}

/** Label-above form field with an inline error slot. */
export function Field({ id, label, error, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className={styles.error} role="alert">
          <AlertCircleIcon size={14} />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string | null;
}

export function Input({ id, label, error, className, ...rest }: InputProps) {
  return (
    <Field id={id} label={label} error={error}>
      <input
        id={id}
        className={[styles.control, className].filter(Boolean).join(' ')}
        {...rest}
      />
    </Field>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  error?: string | null;
}

/** Textarea that grows with its content (capped by CSS max-height). */
export function Textarea({
  id,
  label,
  error,
  className,
  onInput,
  ...rest
}: TextareaProps) {
  // Typed off the attribute so it tracks React's own onInput event type.
  const handleInput = useCallback<
    NonNullable<TextareaHTMLAttributes<HTMLTextAreaElement>['onInput']>
  >(
    (event) => {
      const element = event.currentTarget;
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
      onInput?.(event);
    },
    [onInput],
  );

  return (
    <Field id={id} label={label} error={error}>
      <textarea
        id={id}
        rows={3}
        onInput={handleInput}
        className={[styles.control, styles.textarea, className]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
    </Field>
  );
}

/** Form-level error line (submit failures, API rejections). */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p className={styles.error} role="alert">
      <AlertCircleIcon size={14} />
      {children}
    </p>
  );
}
