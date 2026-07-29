'use client';

import {
  useCallback,
  useEffect,
  useRef,
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
        <p id={`${id}-error`} className={styles.error} role="alert">
          <AlertCircleIcon size={14} />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Links a control to its Field error slot for assistive tech. */
function errorProps(id: string, error: string | null | undefined) {
  return error
    ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` }
    : {};
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
        {...errorProps(id, error)}
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

/**
 * Sets the border-box height to fit the content. scrollHeight excludes
 * borders, so add them back (box-sizing is border-box globally).
 */
function fitToContent(element: HTMLTextAreaElement) {
  element.style.height = 'auto';
  const borders = element.offsetHeight - element.clientHeight;
  element.style.height = `${element.scrollHeight + borders}px`;
}

/** Textarea that grows with its content (capped by CSS max-height). */
export function Textarea({
  id,
  label,
  error,
  className,
  onInput,
  value,
  ...rest
}: TextareaProps) {
  const innerRef = useRef<HTMLTextAreaElement>(null);

  // React sets the DOM value without firing input events on controlled
  // updates (e.g. clearing after submit) — refit on value changes too.
  useEffect(() => {
    if (innerRef.current) {
      fitToContent(innerRef.current);
    }
  }, [value]);

  // Typed off the attribute so it tracks React's own onInput event type.
  const handleInput = useCallback<
    NonNullable<TextareaHTMLAttributes<HTMLTextAreaElement>['onInput']>
  >(
    (event) => {
      fitToContent(event.currentTarget);
      onInput?.(event);
    },
    [onInput],
  );

  return (
    <Field id={id} label={label} error={error}>
      <textarea
        ref={innerRef}
        id={id}
        rows={3}
        value={value}
        onInput={handleInput}
        className={[styles.control, styles.textarea, className]
          .filter(Boolean)
          .join(' ')}
        {...errorProps(id, error)}
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
