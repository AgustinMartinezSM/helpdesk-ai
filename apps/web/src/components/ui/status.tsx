import type { TicketPriority, TicketStatus } from '../../lib/tickets';
import styles from './status.module.css';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const STATUS_CLASS: Record<TicketStatus, string> = {
  open: styles.open,
  in_progress: styles.inProgress,
  resolved: styles.resolved,
  closed: styles.closed,
};

const PRIORITY_CLASS: Record<TicketPriority, string> = {
  low: styles.pLow,
  medium: styles.pMedium,
  high: styles.pHigh,
  urgent: styles.pUrgent,
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`${styles.badge} ${STATUS_CLASS[status]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityDot({ priority }: { priority: TicketPriority }) {
  return (
    <span className={styles.priority}>
      <span
        className={`${styles.dot} ${PRIORITY_CLASS[priority]}`}
        aria-hidden="true"
      />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
