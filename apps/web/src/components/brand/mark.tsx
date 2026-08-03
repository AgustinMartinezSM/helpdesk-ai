import styles from './mark.module.css';

/**
 * The HelpDesk AI mark.
 *
 * WHAT IT DRAWS, and why this and not something else. A dot, a bar, and an
 * end stop, left to right. It is the smallest true picture of the product:
 * every ticket in the interface is already a priority dot followed by a row,
 * so the mark is the product's own visual unit rather than a metaphor
 * borrowed from outside it. Read left to right it is also the promise — a
 * signal arrives as a point with nowhere to be, gets a track, and reaches an
 * end somebody decided.
 *
 * What it deliberately is NOT (brand-strategy.md): a speech bubble, which
 * would say chat; a sparkle, which is reserved for the AI capabilities and
 * would give top billing to the least available part of the product; a
 * headset; a robot; a microservice diagram; and — the one it replaced — a
 * stock Lucide ticket glyph on a Tailwind-indigo tile, which was competent
 * and belonged to nobody.
 *
 * WHY IT NEEDS NO LIGHT AND DARK VARIANT. The field is `--brand`, which is
 * one value in both themes, and the ink on it is `--brand-on` at a measured
 * 14.83:1. That is the practical payoff of the brand colour never changing:
 * one asset, one file, no fork.
 *
 * `tone="mono"` drops the field and draws the glyph in `currentColor`, for
 * places that cannot carry a colour field — a favicon mask, a stamp, print,
 * or a surface whose background is already the brand.
 */
export function Mark({
  size = 28,
  tone = 'brand',
  className,
}: {
  size?: number;
  tone?: 'brand' | 'mono';
  className?: string;
}) {
  const mono = tone === 'mono';
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={[styles.mark, className].filter(Boolean).join(' ')}
    >
      {!mono && <rect width="32" height="32" rx="8" className={styles.field} />}
      <g className={mono ? styles.inkMono : styles.ink}>
        {/* The signal: a point, not yet anywhere. */}
        <circle cx="8" cy="16" r="3.25" />
        {/* The track it is placed on. */}
        <rect x="13.5" y="14.25" width="8.5" height="3.5" rx="1.75" />
        {/* The end somebody decided. Taller, so it reads as a stop rather
            than as more track — and it survives down to 16px. */}
        <rect x="24" y="10" width="3.5" height="12" rx="1.75" />
      </g>
    </svg>
  );
}
