import type { Metadata } from 'next';
import { ArchitectureDiagram } from '../../../components/public/architecture-diagram';
import { Reveal } from '../../../components/public/reveal';
import { Section } from '../../../components/public/section';
import { ButtonLink } from '../../../components/ui/button';
import {
  ActivityIcon,
  DatabaseIcon,
  GitBranchIcon,
  LayersIcon,
  ServerIcon,
  ZapIcon,
} from '../../../components/ui/icons';
import { siteConfig } from '../../../lib/site-config';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Engineering',
  description:
    'The architecture behind HelpDesk AI: an Nx monorepo with nine applications and four libraries, event-driven services, and decisions documented in ADRs.',
};

const APPLICATIONS = [
  {
    name: 'web',
    kind: 'Next.js 16',
    role: 'Public site and the authenticated product UI',
  },
  {
    name: 'web-bff',
    kind: 'NestJS',
    role: 'Browser-facing API: httpOnly session cookies, token exchange',
  },
  {
    name: 'api-gateway',
    kind: 'NestJS',
    role: 'Single platform entry point, routing to every domain service',
  },
  {
    name: 'auth-service',
    kind: 'NestJS + Prisma',
    role: 'Registration, login, refresh rotation, reuse detection',
  },
  {
    name: 'tickets-service',
    kind: 'NestJS + Prisma',
    role: 'Ticket lifecycle, comments, internal notes, history',
  },
  {
    name: 'users-service',
    kind: 'NestJS + Prisma',
    role: 'User profile projections from auth events',
  },
  {
    name: 'audit-service',
    kind: 'NestJS + Prisma',
    role: 'Immutable event trail consuming the full firehose',
  },
  {
    name: 'notification-service',
    kind: 'NestJS + Prisma',
    role: 'In-app notifications projected from domain events',
  },
  {
    name: 'analytics-service',
    kind: 'NestJS + Prisma',
    role: 'Per-ticket metric snapshots for staff summaries',
  },
];

const LIBRARIES = [
  {
    name: 'libs/messaging',
    role: 'Versioned event contracts, RabbitMQ topology, DLQs, firehose subscriptions',
  },
  {
    name: 'libs/security',
    role: 'JWT access guard, actor model, staff/admin role helpers',
  },
  {
    name: 'libs/configuration',
    role: 'Fail-fast environment validation before anything boots',
  },
  {
    name: 'libs/observability',
    role: 'Structured logging, redaction, request correlation',
  },
];

const STACK = [
  'Next.js 16',
  'React 19',
  'NestJS 11',
  'Nx 23',
  'TypeScript 6',
  'pnpm 11',
  'PostgreSQL 18',
  'Redis 8',
  'RabbitMQ 4.3',
  'Prisma 7',
  'Docker Compose',
  'Jest 30',
  'GitHub Actions',
];

const DECISIONS = [
  {
    icon: <LayersIcon size={16} />,
    title: 'Monorepo over polyrepo',
    reference: 'ADR 0001',
    body: 'One Nx workspace gives atomic cross-service changes, a single toolchain and an affected graph that keeps CI honest. Polyrepo autonomy solves problems this project does not have.',
  },
  {
    icon: <ServerIcon size={16} />,
    title: 'A BFF and a gateway — deliberately both',
    reference: 'ADR 0002',
    body: 'The BFF owns browser concerns: session cookies, token exchange, CORS. The gateway owns platform routing. Merging them would couple browser security to service topology.',
  },
  {
    icon: <DatabaseIcon size={16} />,
    title: 'Database per service',
    reference: 'ADR 0003',
    body: 'Each service connects to its own PostgreSQL database with its own credentials. Integration happens through APIs and events — never through another service’s tables.',
  },
  {
    icon: <ZapIcon size={16} />,
    title: 'HTTP for commands, events for facts',
    reference: 'ADR 0005',
    body: 'Synchronous calls express intent and can be rejected; events state what already happened. Versioned contracts on a topic exchange, with a dead-letter queue per consumer.',
  },
  {
    icon: <ActivityIcon size={16} />,
    title: 'Correlation ids now, tracing later',
    reference: 'Observability notes',
    body: 'A correlation id follows every request across services inside structured logs. Full distributed tracing is planned for when there is an operation to observe — not before.',
  },
  {
    icon: <GitBranchIcon size={16} />,
    title: 'Transactional outbox — deferred on purpose',
    reference: 'ADR 0006',
    body: 'Event publishing is best-effort today. The ADR records the exact triggers that would justify an outbox, so the complexity arrives with evidence, not by default.',
  },
];

const DELIVERY = [
  'One gate for everything: lint, test, build and typecheck across all thirteen projects',
  'Fast unit suites per project, plus integration suites that run against real PostgreSQL and RabbitMQ',
  'Conventional commits enforced by commitlint; formatting and lint fixes applied on every commit',
  'A GitHub Actions workflow provisions throwaway databases per integration target',
  'Sprint progress logs and ADRs live in the repository (docs/progress, docs/adr)',
];

export default function EngineeringPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>Engineering</p>
          <h1 className={styles.title}>
            Built like a platform, documented like one
          </h1>
          <p className={styles.lead}>
            Nine applications and four libraries in one Nx workspace — an
            event-driven system where every important decision has a written
            rationale. This page is the honest tour.
          </p>
        </div>
      </header>

      <Section eyebrow="Architecture" title="The shape of the system">
        <Reveal>
          <ArchitectureDiagram />
        </Reveal>
        <div className={styles.appsGrid}>
          {APPLICATIONS.map((app) => (
            <article key={app.name} className={styles.appCard}>
              <h3 className={styles.appName}>{app.name}</h3>
              <p className={styles.appKind}>{app.kind}</p>
              <p className={styles.appRole}>{app.role}</p>
            </article>
          ))}
        </div>
        <div className={styles.libsRow}>
          {LIBRARIES.map((lib) => (
            <article key={lib.name} className={styles.libCard}>
              <h3 className={styles.libName}>{lib.name}</h3>
              <p className={styles.libRole}>{lib.role}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        tone="raised"
        eyebrow="Stack"
        title="Boring where it should be, current where it counts"
      >
        <ul className={styles.stackRow} role="list">
          {STACK.map((item) => (
            <li key={item} className={styles.stackChip}>
              {item}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        eyebrow="Decisions"
        title="Choices you can interrogate"
        lead="Each of these has a written rationale in the repository — these are the summaries, not the marketing."
      >
        <div className={styles.decisionsGrid}>
          {DECISIONS.map((decision) => (
            <article key={decision.title} className={styles.decisionCard}>
              <div className={styles.decisionTop}>
                <span className={styles.decisionIcon}>{decision.icon}</span>
                <span className={styles.decisionRef}>{decision.reference}</span>
              </div>
              <h3 className={styles.decisionTitle}>{decision.title}</h3>
              <p className={styles.decisionBody}>{decision.body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        tone="raised"
        eyebrow="Delivery"
        title="How the work actually ships"
      >
        <ul className={styles.deliveryList} role="list">
          {DELIVERY.map((item) => (
            <li key={item} className={styles.deliveryItem}>
              {item}
            </li>
          ))}
        </ul>
        <p className={styles.honestNote}>
          Honest status: the repository is still local-only. The CI workflow is
          defined and exercised locally through the same Nx targets, but its
          first remote run is a planned milestone, not a past one.
        </p>
        <div className={styles.actions}>
          {siteConfig.githubUrl ? (
            <ButtonLink href={siteConfig.githubUrl}>
              Browse the source on GitHub
            </ButtonLink>
          ) : null}
          <ButtonLink href="/how-it-works" variant="secondary">
            See the workflow it powers
          </ButtonLink>
          <ButtonLink href="/contact" variant="ghost">
            Ask about a decision
          </ButtonLink>
        </div>
      </Section>
    </div>
  );
}
