import type { ReactNode } from 'react';
import styles from './section.module.css';

/**
 * Surface level for a public section. Sprint 7.6.1 replaced the previous
 * two-value default/raised pair, whose surfaces differed by 1.04:1 and
 * therefore read as one continuous page.
 *
 * - `default`   the page base
 * - `raised`    an elevated band (cards sit on it with real separation)
 * - `sunken`    a recessed band, for supporting or secondary content
 * - `tinted`    warm brand-tinted band, for human/narrative sections
 * - `technical` sunken band with a faint grid, for architecture content
 */
export type SectionTone =
  'default' | 'raised' | 'sunken' | 'tinted' | 'technical';

export interface SectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  children: ReactNode;
  tone?: SectionTone;
}

const TONE_CLASS: Record<SectionTone, string> = {
  default: '',
  raised: styles.raised,
  sunken: styles.sunken,
  tinted: styles.tinted,
  technical: styles.technical,
};

/** Standard public-page section: eyebrow, heading, lead and content. */
export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  tone = 'default',
}: SectionProps) {
  return (
    <section
      id={id}
      data-tone={tone}
      className={[styles.section, TONE_CLASS[tone]].filter(Boolean).join(' ')}
    >
      <div className={styles.container}>
        <header className={styles.header}>
          {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
          <h2 className={styles.title}>{title}</h2>
          {lead ? <p className={styles.lead}>{lead}</p> : null}
        </header>
        {children}
      </div>
    </section>
  );
}
