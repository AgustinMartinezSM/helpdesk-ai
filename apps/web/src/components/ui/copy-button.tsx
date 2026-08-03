'use client';

import { useCallback, useRef, useState } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from './button';
import { CheckIcon, CopyIcon } from './icons';

export interface CopyButtonProps {
  /** The text to place on the clipboard. */
  value: string;
  label?: string;
  copiedLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Injected in tests. jsdom implements no clipboard, and stubbing a
   * read-only global is worse than admitting the seam: production passes
   * nothing and gets navigator.clipboard.
   */
  write?: (value: string) => Promise<void>;
  className?: string;
}

/**
 * Copies a value and says so.
 *
 * Built for the invitation code, which exists in exactly one HTTP response
 * and can never be recovered — so the failure path matters more than usual.
 * A clipboard write can be refused (permissions, an insecure origin, an
 * unfocused document), and silently pretending otherwise would tell an admin
 * they have a code they do not. The refusal is stated instead, and the code
 * itself stays on screen to be selected by hand.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  variant = 'secondary',
  size = 'sm',
  write,
  className,
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    const writer =
      write ??
      (typeof navigator !== 'undefined' && navigator.clipboard
        ? (text: string) => navigator.clipboard.writeText(text)
        : undefined);
    if (!writer) {
      setState('failed');
      return;
    }
    try {
      await writer(value);
      setState('copied');
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => setState('idle'), 4000);
    } catch {
      setState('failed');
    }
  }, [value, write]);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => void copy()}
      >
        {state === 'copied' ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
        {state === 'copied' ? copiedLabel : label}
      </Button>
      {/* Announced rather than only coloured: the outcome of a copy is
          invisible, and it is the difference between having the code and
          not having it. */}
      <span className="sr-only" role="status">
        {state === 'copied'
          ? `${copiedLabel} to the clipboard.`
          : state === 'failed'
            ? 'Could not reach the clipboard. Select the text and copy it manually.'
            : ''}
      </span>
      {state === 'failed' ? (
        <span role="alert" className="sr-only">
          Copy failed.
        </span>
      ) : null}
    </>
  );
}
