import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';
import styles from './button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

function buttonClasses(
  variant: ButtonVariant,
  size: ButtonSize,
  extra?: string,
): string {
  return [styles.button, styles[variant], styles[size], extra]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={buttonClasses(variant, size, className)}
      // aria-disabled (not disabled) while loading: the button stays
      // focusable, so keyboard focus is not dropped mid-submit. Forms
      // must guard their submit handlers against re-entry.
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A Next.js Link styled exactly like a Button — for CTA navigation. */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      className={buttonClasses(variant, size, className as string | undefined)}
      {...rest}
    />
  );
}
