import styles from './architecture-diagram.module.css';

interface Tier {
  name: string;
  detail: string;
}

const PIPELINE: Tier[] = [
  { name: 'Web', detail: 'Next.js' },
  { name: 'Web BFF', detail: 'session + cookies' },
  { name: 'API Gateway', detail: 'routing + guards' },
  { name: 'Domain services', detail: 'auth · tickets · users' },
  { name: 'RabbitMQ', detail: 'domain events' },
  { name: 'Platform services', detail: 'audit · notify · analytics' },
];

const DESCRIPTION =
  'Request flow: the Next.js web app talks to a backend-for-frontend, ' +
  'which forwards to an API gateway that routes to the domain services ' +
  '(auth, tickets, users). Domain services publish events to RabbitMQ, ' +
  'which platform services (audit, notifications, analytics) consume.';

/**
 * Lightweight architecture pipeline. The animated event dot is purely
 * decorative; the full flow is described in text for assistive tech.
 */
export function ArchitectureDiagram() {
  return (
    <figure className={styles.figure}>
      <div role="img" aria-label={DESCRIPTION}>
        <div className={styles.pipeline} aria-hidden="true">
          {PIPELINE.map((tier, index) => (
            <div key={tier.name} className={styles.step}>
              <div className={styles.node}>
                <p className={styles.nodeName}>{tier.name}</p>
                <p className={styles.nodeDetail}>{tier.detail}</p>
              </div>
              {index < PIPELINE.length - 1 ? (
                <div className={styles.connector}>
                  <span className={styles.pulse} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <figcaption className={styles.caption}>
        Every write flows left to right; platform services react to events,
        never to direct calls.
      </figcaption>
    </figure>
  );
}
