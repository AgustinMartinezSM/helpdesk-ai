import type { ReactNode } from 'react';
import styles from './section.module.css';

export interface SectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  children: ReactNode;
  /** Alternate surface background to create page rhythm. */
  tone?: 'default' | 'raised';
}

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
      className={
        tone === 'raised'
          ? `${styles.section} ${styles.raised}`
          : styles.section
      }
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
