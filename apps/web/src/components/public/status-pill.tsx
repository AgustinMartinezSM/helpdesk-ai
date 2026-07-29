import {
  CAPABILITY_STATUS_LABELS,
  type CapabilityStatus,
} from '../../lib/product-status';
import styles from './status-pill.module.css';

const STATUS_CLASS: Record<CapabilityStatus, string> = {
  available: styles.available,
  'api-ready': styles.apiReady,
  'in-development': styles.inDevelopment,
  planned: styles.planned,
};

/**
 * Honest capability status. The label is always text — status is never
 * communicated by color alone.
 */
export function StatusPill({ status }: { status: CapabilityStatus }) {
  return (
    <span className={`${styles.pill} ${STATUS_CLASS[status]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {CAPABILITY_STATUS_LABELS[status]}
    </span>
  );
}
