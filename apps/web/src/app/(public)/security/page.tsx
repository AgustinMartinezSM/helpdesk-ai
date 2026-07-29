import type { Metadata } from 'next';
import { Section } from '../../../components/public/section';
import { StatusPill } from '../../../components/public/status-pill';
import {
  FileTextIcon,
  LockIcon,
  ShieldCheckIcon,
} from '../../../components/ui/icons';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'The real security posture of HelpDesk AI: password hashing, token rotation, role guards, validation, safe logging and honest limits — no invented certifications.',
};

interface Principle {
  title: string;
  detail: string;
}

const IDENTITY: Principle[] = [
  {
    title: 'Password hashing',
    detail:
      'argon2id with OWASP-recommended parameters. Hashes are stored as PHC strings, so parameters can be raised later without invalidating existing credentials.',
  },
  {
    title: 'Access tokens',
    detail:
      'Short-lived (15 minutes) signed JWTs that live only in browser memory — never in localStorage, never readable by injected scripts.',
  },
  {
    title: 'Refresh token rotation',
    detail:
      'Opaque tokens held in an httpOnly cookie managed by the BFF. Only a sha256 of the secret is stored, and every use rotates the token.',
  },
  {
    title: 'Reuse detection',
    detail:
      'Presenting an already-rotated refresh token is treated as theft: every session of that user is revoked immediately.',
  },
  {
    title: 'Enumeration resistance',
    detail:
      'Login failures return identical responses for unknown emails and wrong passwords, with comparable timing, so accounts cannot be discovered.',
  },
  {
    title: 'Brute-force mitigation',
    detail:
      'Per-IP throttling on credential endpoints (register, login, refresh) returns 429 before passwords can be guessed at scale.',
  },
];

const PLATFORM: Principle[] = [
  {
    title: 'Roles and permissions',
    detail:
      'Roles travel in the token and are enforced by guards in every service: ticket transitions are staff-only, analytics summaries are staff-only, the audit trail is admin-only.',
  },
  {
    title: 'Input validation',
    detail:
      'A global validation pipe with whitelisting rejects unknown fields outright — malformed requests never reach domain logic.',
  },
  {
    title: 'HTTP hardening',
    detail:
      'helmet runs on every NestJS application; CORS is a strict allowlist on the BFF and disabled on internal services, which browsers never call.',
  },
  {
    title: 'Safe error handling',
    detail:
      'Domain errors map to explicit, safe HTTP responses. Stack traces and internals are never serialized to clients.',
  },
  {
    title: 'Safe logging',
    detail:
      'Structured JSON logs with minimal serializers and a redaction safety net (authorization, cookies). Security events log user ids — never emails or passwords.',
  },
  {
    title: 'Fail-fast configuration',
    detail:
      'Invalid or missing configuration stops a service before it wires anything. The JWT secret has no default: no secret, no boot.',
  },
];

const GOVERNANCE: Principle[] = [
  {
    title: 'Audit events',
    detail:
      'An audit service consumes every domain event into an immutable, admin-only trail keyed by event id — duplicates are structurally impossible.',
  },
  {
    title: 'Data ownership',
    detail:
      'Each service owns its PostgreSQL database with its own credentials. There are no shared tables and no cross-service queries — by architecture, not by convention.',
  },
  {
    title: 'Secret management',
    detail:
      'No secrets in the repository. Git-ignored .env files per service, committed .env.example placeholders, and CI credentials that exist only inside throwaway containers.',
  },
  {
    title: 'Dependency management',
    detail:
      'pnpm blocks dependency lifecycle scripts by default; only an explicit allow-list may run build scripts, and install-time telemetry is deliberately blocked.',
  },
  {
    title: 'Environment separation',
    detail:
      'Development infrastructure is local-only containers. Nothing is exposed beyond localhost, and demo data never mixes with anything real.',
  },
  {
    title: 'File restrictions',
    detail:
      'Attachments are not implemented yet — when they arrive, upload validation (type, size, content) is a precondition, not a follow-up.',
  },
];

const NOT_CLAIMED = [
  'SOC 2 or ISO 27001 certification',
  'GDPR or HIPAA compliance programs',
  'Independent penetration testing',
  'Production hardening or an on-call operation',
];

export default function SecurityPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>Security</p>
          <h1 className={styles.title}>Security as a product requirement</h1>
          <p className={styles.lead}>
            Everything on this page describes behavior you can read in the
            codebase today. This is a portfolio project: it borrows the
            discipline of production systems, and it refuses to borrow their
            claims.
          </p>
        </div>
      </header>

      <Section
        eyebrow="Identity & sessions"
        title="Authentication built the boring, correct way"
      >
        <div className={styles.grid}>
          {IDENTITY.map((principle) => (
            <article key={principle.title} className={styles.card}>
              <span className={styles.cardIcon}>
                <LockIcon size={16} />
              </span>
              <h3 className={styles.cardTitle}>{principle.title}</h3>
              <p className={styles.cardDetail}>{principle.detail}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        tone="raised"
        eyebrow="Platform hardening"
        title="Guarded at every layer"
      >
        <div className={styles.grid}>
          {PLATFORM.map((principle) => (
            <article key={principle.title} className={styles.card}>
              <span className={styles.cardIcon}>
                <ShieldCheckIcon size={16} />
              </span>
              <h3 className={styles.cardTitle}>{principle.title}</h3>
              <p className={styles.cardDetail}>{principle.detail}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section eyebrow="Data & governance" title="Boundaries you can audit">
        <div className={styles.grid}>
          {GOVERNANCE.map((principle) => (
            <article key={principle.title} className={styles.card}>
              <span className={styles.cardIcon}>
                <FileTextIcon size={16} />
              </span>
              <h3 className={styles.cardTitle}>{principle.title}</h3>
              <p className={styles.cardDetail}>{principle.detail}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        tone="raised"
        eyebrow="Honesty"
        title="What this project does not claim"
        lead="A security page that inflates its posture is itself a vulnerability. For clarity:"
      >
        <ul className={styles.notClaimedList}>
          {NOT_CLAIMED.map((item) => (
            <li key={item} className={styles.notClaimedItem}>
              {item}
            </li>
          ))}
        </ul>
        <div className={styles.plannedBlock}>
          <h3 className={styles.plannedTitle}>
            On the security roadmap <StatusPill status="planned" />
          </h3>
          <p className={styles.plannedText}>
            Gateway-wide rate limiting, password reset and email verification
            flows, session management (list and revoke your own sessions),
            upload validation for attachments, and a dependency audit step in CI
            once the repository lives on a remote.
          </p>
        </div>
      </Section>
    </div>
  );
}
