import type { Metadata } from 'next';
import Link from 'next/link';
import { ArchitectureDiagram } from '../../../components/public/architecture-diagram';
import { Reveal } from '../../../components/public/reveal';
import { Section } from '../../../components/public/section';
import { StatusPill } from '../../../components/public/status-pill';
import { ButtonLink } from '../../../components/ui/button';
import { ArrowRightIcon } from '../../../components/ui/icons';
import { StatusBadge } from '../../../components/ui/status';
import type { CapabilityStatus } from '../../../lib/product-status';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'Follow a support request from submission through validation, events, planned AI analysis and human decisions — with every step honestly labeled.',
};

interface WorkflowStep {
  title: string;
  description: string;
  status: CapabilityStatus;
}

const STEPS: WorkflowStep[] = [
  {
    title: 'A user submits a support request',
    description:
      'The web app sends it through the BFF with the session held in an httpOnly cookie — the browser never stores tokens.',
    status: 'available',
  },
  {
    title: 'The request is validated',
    description:
      'Explicit DTOs reject anything malformed before it reaches the domain. Unknown fields are stripped, limits enforced.',
    status: 'available',
  },
  {
    title: 'The ticket is persisted',
    description:
      'The tickets service owns the write, in its own PostgreSQL database. No other service can touch that data directly.',
    status: 'available',
  },
  {
    title: 'A domain event is published',
    description:
      'ticket.created.v1 goes out on the helpdesk.events exchange in RabbitMQ. Consumers react; nobody polls.',
    status: 'available',
  },
  {
    title: 'AI analysis is requested asynchronously',
    description:
      'The AI service will consume the event off the queue — nothing ever blocks the person who filed the request.',
    status: 'planned',
  },
  {
    title: 'Category, priority and summary suggestions are generated',
    description:
      'The analysis produces suggestions, never actions. They are stored alongside the ticket, clearly marked as suggestions.',
    status: 'planned',
  },
  {
    title: 'A technician reviews the suggestions',
    description:
      'Suggestions appear beside the ticket for a person to accept, adjust or ignore — the interface makes the difference obvious.',
    status: 'planned',
  },
  {
    title: 'The technician acts — and stays responsible',
    description:
      'Explicit transitions only: start progress, resolve, reopen, close. The requester keeps the final "confirm fix and close".',
    status: 'available',
  },
  {
    title: 'Every change lands in the audit history',
    description:
      'The audit service consumes every domain event into an immutable, admin-only trail — including what AI suggested.',
    status: 'api-ready',
  },
  {
    title: 'Notifications are generated when appropriate',
    description:
      'The notification service tells requesters and assignees what changed. The actor is never notified about their own action.',
    status: 'api-ready',
  },
  {
    title: 'Managers observe operational metrics',
    description:
      'The analytics service projects per-ticket snapshots from the same event stream, powering staff-only summaries.',
    status: 'api-ready',
  },
];

const EVENTS = [
  'user.registered.v1',
  'ticket.created.v1',
  'ticket.status-changed.v1',
  'ticket.assigned.v1',
  'ticket.comment-added.v1',
];

export default function HowItWorksPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>How it works</p>
          <h1 className={styles.title}>
            From request to resolution — honestly labeled
          </h1>
          <p className={styles.lead}>
            This is the real workflow of the platform. Steps marked{' '}
            <StatusPill status="available" /> work end-to-end today,{' '}
            <StatusPill status="api-ready" /> run behind the gateway without a
            product UI yet, and <StatusPill status="planned" /> describes the
            designed AI behavior that has not been built.
          </p>
        </div>
      </header>

      <Section
        eyebrow="The journey of a ticket"
        title="Eleven steps, one principle: people decide"
      >
        <ol className={styles.timeline}>
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={(index % 3) * 60}>
              <li className={styles.step}>
                <div className={styles.stepMarker} aria-hidden="true">
                  <span className={styles.stepIndex}>{index + 1}</span>
                  <span className={styles.stepLine} />
                </div>
                <div className={styles.stepBody}>
                  <div className={styles.stepHeading}>
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                    <StatusPill status={step.status} />
                  </div>
                  <p className={styles.stepText}>{step.description}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </Section>

      <Section
        tone="raised"
        eyebrow="Ticket states"
        title="Explicit transitions, no magic strings"
        lead="The domain allows exactly these movements — anything else is rejected before it happens."
      >
        <div
          className={styles.statesRow}
          role="img"
          aria-label="Ticket lifecycle: open moves to in progress via Start progress; in progress moves to resolved via Resolve; resolved moves to closed via Close. Reopen returns in-progress or resolved tickets to open."
        >
          <div className={styles.statesFlow} aria-hidden="true">
            <StatusBadge status="open" />
            <span className={styles.transition}>Start progress →</span>
            <StatusBadge status="in_progress" />
            <span className={styles.transition}>Resolve →</span>
            <StatusBadge status="resolved" />
            <span className={styles.transition}>Close →</span>
            <StatusBadge status="closed" />
          </div>
        </div>
        <p className={styles.statesNote}>
          Reopen returns an in-progress or resolved ticket to open; requesters
          close their own resolved tickets with “Confirm fix and close”.
        </p>
      </Section>

      <Section
        eyebrow="Domain events"
        title="Everything downstream reacts to these"
        lead="Versioned contracts on a RabbitMQ topic exchange — audit, notifications and analytics never call the domain directly."
      >
        <ul className={styles.eventsRow}>
          {EVENTS.map((event) => (
            <li key={event} className={styles.eventChip}>
              {event}
            </li>
          ))}
        </ul>
        <Reveal>
          <ArchitectureDiagram />
        </Reveal>
      </Section>

      <Section
        tone="raised"
        eyebrow="Today vs. target"
        title="What is real today, and what is designed"
      >
        <div className={styles.contrastGrid}>
          <div className={styles.contrastCard}>
            <h3 className={styles.contrastTitle}>Implemented behavior</h3>
            <p className={styles.contrastText}>
              Authentication, the full ticket lifecycle, comments, internal
              notes, history — plus audit, notification and analytics services
              consuming real events behind the gateway.
            </p>
          </div>
          <div className={styles.contrastCard}>
            <h3 className={styles.contrastTitle}>Target architecture</h3>
            <p className={styles.contrastText}>
              The event backbone the AI service will plug into already exists.
              Adding AI is adding a consumer — not rewiring the platform.
            </p>
          </div>
          <div className={styles.contrastCard}>
            <h3 className={styles.contrastTitle}>Planned AI behavior</h3>
            <p className={styles.contrastText}>
              Summaries, classification, priority and reply suggestions —
              generated asynchronously, presented as suggestions, and never
              executed without a person.
            </p>
          </div>
        </div>
        <div className={styles.ctaRow}>
          <ButtonLink href="/features" variant="secondary">
            Browse all capabilities
          </ButtonLink>
          <Link href="/engineering" className={styles.inlineLink}>
            Read the engineering decisions
            <ArrowRightIcon size={15} />
          </Link>
        </div>
      </Section>
    </div>
  );
}
