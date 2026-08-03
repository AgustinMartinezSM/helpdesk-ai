import { Mark } from './mark';
import styles from './lockup.module.css';

/**
 * The wordmark and its two lockups.
 *
 * THE WORDMARK IS ONE INK WEIGHT. Until Sprint 10.1 the word "AI" was the
 * only coloured word in every header and footer — the visual place of honour
 * given to the least available part of the product, while requests,
 * structure and permissions are what actually works. The name keeps its two
 * letters because renaming is expensive and out of scope; what stopped is
 * amplifying them.
 *
 * CLEAR SPACE is the height of the mark's end stop, which is 3.5/32 of the
 * mark — expressed here as a share of the mark's own box so it scales with
 * it, rather than as a pixel value somebody has to remember.
 *
 * MINIMUM SIZES. `compact` (mark alone) goes down to 16px, which is what the
 * three shapes were sized for. `horizontal` needs 20px of mark for the
 * wordmark beside it to stay readable; below that, use `compact`.
 */
export function Lockup({
  variant = 'horizontal',
  size = 28,
  tone = 'brand',
  className,
}: {
  variant?: 'horizontal' | 'compact';
  size?: number;
  tone?: 'brand' | 'mono';
  className?: string;
}) {
  const mark = <Mark size={size} tone={tone} />;

  if (variant === 'compact') {
    return mark;
  }

  return (
    <span
      className={[styles.lockup, className].filter(Boolean).join(' ')}
      style={{ ['--lockup-mark' as string]: `${size}px` }}
    >
      {mark}
      {/*
        The span around "AI" is kept so the two halves stay addressable — a
        future locale or a future emphasis may want it — but it inherits the
        ink rather than carrying a colour of its own.
      */}
      <span className={styles.wordmark}>
        HelpDesk&nbsp;<span>AI</span>
      </span>
    </span>
  );
}
