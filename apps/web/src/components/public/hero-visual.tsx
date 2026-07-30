import { PriorityDot, StatusBadge } from '../ui/status';
import { CheckIcon, SparklesIcon, UserIcon } from '../ui/icons';
import styles from './hero-visual.module.css';

/**
 * Product-scene composition built from the real design system — a ticket
 * card, the AI-analysis panel and an audit line. Decorative: everything it
 * shows is stated in the surrounding hero copy, so the whole scene is hidden
 * from assistive technologies.
 *
 * The AI values are an illustration, not a captured answer, so the panel
 * carries its own status label (see ADR 0009): the capability is built and
 * reachable, but a deployment has to bring its own provider credentials
 * before it produces anything.
 */
export function HeroVisual() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <div className={styles.glow} />

      <div className={styles.ticketCard}>
        <div className={styles.ticketHeader}>
          <p className={styles.ticketTitle}>
            Projector in room 4B shows no signal
          </p>
          <div className={styles.ticketMeta}>
            <StatusBadge status="open" />
            <PriorityDot priority="high" />
            <span className={styles.metaText}>Created 2 minutes ago</span>
          </div>
        </div>

        <div className={styles.aiPanel}>
          <p className={styles.aiPanelTitle}>
            <SparklesIcon size={14} />
            AI analysis
            <span className={styles.aiStatus}>API ready</span>
          </p>
          <dl className={styles.aiRows}>
            <div className={styles.aiRow}>
              <dt>Category</dt>
              <dd>Hardware / AV</dd>
            </div>
            <div className={styles.aiRow}>
              <dt>Priority</dt>
              <dd>High — client demo on Thursday</dd>
            </div>
            <div className={styles.aiRow}>
              <dt>Summary</dt>
              <dd>HDMI wall plate without power; two cables tested.</dd>
            </div>
          </dl>
        </div>

        <div className={styles.ticketFooter}>
          <span className={styles.assignment}>
            <UserIcon size={13} />
            Unassigned
          </span>
          <span className={styles.audit}>audit · ticket.created.v1</span>
        </div>
      </div>

      <div className={styles.toast}>
        <span className={styles.toastIcon}>
          <CheckIcon size={13} />
        </span>
        <div>
          <p className={styles.toastTitle}>Ticket resolved</p>
          <p className={styles.toastBody}>Waiting for requester confirmation</p>
        </div>
      </div>
    </div>
  );
}
