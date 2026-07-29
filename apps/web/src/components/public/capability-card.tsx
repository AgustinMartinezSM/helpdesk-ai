import type { ReactNode } from 'react';
import type { Capability } from '../../lib/product-status';
import { StatusPill } from './status-pill';
import styles from './capability-card.module.css';

export interface CapabilityCardProps {
  capability: Capability;
  icon?: ReactNode;
}

export function CapabilityCard({ capability, icon }: CapabilityCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.top}>
        {icon ? <span className={styles.icon}>{icon}</span> : null}
        <StatusPill status={capability.status} />
      </div>
      <h3 className={styles.name}>{capability.name}</h3>
      <p className={styles.description}>{capability.description}</p>
      {capability.note ? (
        <p className={styles.note}>{capability.note}</p>
      ) : null}
    </article>
  );
}
