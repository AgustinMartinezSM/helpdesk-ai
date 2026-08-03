import type { Metadata } from 'next';
import Link from 'next/link';
import { ArchitectureDiagram } from '../../../components/public/architecture-diagram';
import { ConversationExample } from '../../../components/public/conversation-example';
import { Reveal } from '../../../components/public/reveal';
import { Section } from '../../../components/public/section';
import { StatusPill } from '../../../components/public/status-pill';
import { capability } from '../../../lib/product-status';
import { ButtonLink } from '../../../components/ui/button';
import {
  ArrowRightIcon,
  MessageSquareIcon,
  PlusIcon,
  SparklesIcon,
  UserIcon,
} from '../../../components/ui/icons';
import { StatusBadge } from '../../../components/ui/status';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'What a support request looks like in HelpDesk AI, from asking for help to a confirmed fix — plus where AI assists the team and how the platform is built.',
};

const JOURNEY = [
  {
    icon: <UserIcon size={18} />,
    title: 'Sign in',
    text: 'Your requests live in one place instead of being spread across chats and inboxes.',
  },
  {
    icon: <PlusIcon size={18} />,
    title: 'Ask for help',
    text: 'Describe the problem in your own words. No form to decode, no procedure to memorize.',
  },
  {
    icon: <MessageSquareIcon size={18} />,
    title: 'Talk it through',
    text: 'Questions and answers stay attached to the request, so nobody has to be caught up twice.',
  },
  {
    icon: <ArrowRightIcon size={18} />,
    title: 'Follow the status',
    text: 'You can see whether anyone has picked it up and what stage it is at, without asking.',
  },
];

const EXAMPLE_REQUESTS = [
  'I cannot access my company email.',
  'The reception printer is not working.',
  'My account is locked.',
  'I need access to a shared folder.',
  'I need a program installed.',
  'The invoicing system closes when I save a payment.',
];

const LIFECYCLE: Array<{
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  meaning: string;
}> = [
  { status: 'open', meaning: 'Submitted and waiting for the team to pick up.' },
  {
    status: 'in_progress',
    meaning: 'Someone has taken it on and is working through it.',
  },
  {
    status: 'resolved',
    meaning: 'The team believes it is fixed and is waiting for you to confirm.',
  },
  {
    status: 'closed',
    meaning: 'Confirmed done. The full history stays available.',
  },
];

/**
 * The product's structural vocabulary, taught in the order somebody would
 * meet it rather than in the order the schema declares it.
 *
 * Every term here is the product's own word, not the model's — ADR 0016 is
 * explicit that the two may differ, so this says "service point" where the
 * database says "operational station", and the examples use the names a real
 * place would have.
 */
const STRUCTURE = [
  {
    term: 'Organization',
    detail:
      'Your company. Everything below belongs to exactly one, and nothing in one organization is visible from another.',
  },
  {
    term: 'Branch',
    detail:
      'A place you work from — a store, an office, a workshop. A request carries the branch it came from, checked against your real branches when it is created.',
  },
  {
    term: 'Department',
    detail:
      'The area inside a branch where the person who asked works: accounting, the shop floor, reception. It describes the requester, not the fix.',
  },
  {
    term: 'Service point',
    detail:
      'A specific spot inside a branch — till 2, the reception desk, the meeting room. It is a place, never a login: a service point signs nobody in.',
  },
  {
    term: 'Support team',
    detail:
      'The group that resolves requests. It belongs to the organization rather than to a branch, so one team can cover everywhere, several branches, or just one.',
  },
];

const ORGANIZATION_ROLES = [
  {
    role: 'Employees',
    detail: 'Submit requests and follow them without chasing anyone.',
  },
  {
    role: 'Technicians',
    detail:
      'Work the queue with priorities, internal notes and the full history of each request.',
  },
  {
    role: 'Managers',
    detail:
      'Understand the workload from live figures rather than end-of-week guesses.',
  },
  {
    role: 'Administrators',
    detail:
      'Rely on roles being enforced everywhere and on an audit trail that records every action.',
  },
];

const AI_SUGGESTIONS = [
  { label: 'Summary', value: 'The user cannot access the invoicing system.' },
  { label: 'Category', value: 'Access and credentials' },
  { label: 'Priority', value: 'High' },
  { label: 'Reason', value: 'The issue blocks a time-sensitive task.' },
  {
    label: 'Next step',
    value:
      'Check whether the account is locked, then start credential recovery.',
  },
];

export default function HowItWorksPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>How it works</p>
          <h1 className={styles.title}>
            What actually happens when someone asks for help
          </h1>
          <p className={styles.lead}>
            Start here if you have never used a help desk before. This page
            walks through a real request from the moment it is written to the
            moment it is confirmed fixed — then covers where AI assists the
            team, and finally how the platform is put together.
          </p>
        </div>
      </header>

      {/* ------------------------------------------ PART A — using it */}

      <Section
        eyebrow="Part 1 · Using HelpDesk AI"
        title="A ticket is just a request for help that stays organized"
        lead="Everywhere on this site, “ticket” means one thing: a request for help that keeps its status, its full conversation and its history in a single place — instead of scattering across messages, emails and spreadsheets."
      >
        <div className={styles.journeyGrid}>
          {JOURNEY.map((step, index) => (
            <Reveal key={step.title} delay={index * 60}>
              <article className={styles.journeyCard}>
                <span className={styles.journeyIcon}>{step.icon}</span>
                <h3 className={styles.journeyTitle}>{step.title}</h3>
                <p className={styles.journeyText}>{step.text}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <div className={styles.requestsBlock}>
          <h3 className={styles.blockTitle}>
            The kind of thing people actually ask
          </h3>
          <ul className={styles.requestList} role="list">
            {EXAMPLE_REQUESTS.map((request) => (
              <li key={request} className={styles.requestItem}>
                “{request}”
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section
        tone="raised"
        eyebrow="Following along"
        title="Four states, and what each one means for you"
        lead="You never have to ask “is anyone looking at this?” — the request answers that itself."
      >
        <ul className={styles.lifecycleList} role="list">
          {LIFECYCLE.map((entry) => (
            <li key={entry.status} className={styles.lifecycleItem}>
              <StatusBadge status={entry.status} />
              <span className={styles.lifecycleMeaning}>{entry.meaning}</span>
            </li>
          ))}
        </ul>
        <p className={styles.lifecycleNote}>
          You have the final word on your own request: when the team marks it
          resolved, closing it is your call.
        </p>
      </Section>

      <Section
        eyebrow="A complete example"
        title="One request, from locked account to confirmed fix"
        lead="This is the whole point of the product: not a list of records, but an organized conversation with an owner, a status, context and an ending."
      >
        <Reveal>
          <ConversationExample />
        </Reveal>
      </Section>

      <Section
        tone="sunken"
        eyebrow="Where the work happens"
        title="A request knows the place it came from"
        lead="Most help desks treat location as a text field somebody types into. This one models it, because “the till is broken” is not actionable until you know which till."
      >
        <dl className={styles.structureList}>
          {STRUCTURE.map((entry) => (
            <div key={entry.term} className={styles.structureItem}>
              <dt className={styles.structureTerm}>{entry.term}</dt>
              <dd className={styles.structureDetail}>{entry.detail}</dd>
            </div>
          ))}
        </dl>

        {/*
          The distinction ADR 0022's first draft got wrong, in the same words
          the Organization screen uses inside the product. It has never
          appeared on the public site before, and it is the single sentence
          most likely to stop somebody modelling their own company wrong.
        */}
        <p className={styles.structureNote}>
          <strong>A department is not a support team.</strong> A department says
          where somebody works; a support team says what they fix. One central
          team can serve every branch, or a team can cover only the branches it
          is responsible for — and the people who ask are organized separately
          from the people who resolve.
        </p>
        <p className={styles.structureNote}>
          None of this is compulsory. A company at one address with one person
          who fixes things can create a single support team and never touch
          branches or departments at all. The structure is there for the day a
          second location makes “which one?” a real question.
        </p>
        <p className={styles.structureNote}>
          Each organization&apos;s data is separated in the database itself, so
          one organization cannot read another&apos;s — see the{' '}
          <Link href="/security" className={styles.inlineLink}>
            security page
          </Link>{' '}
          for how that is enforced.
        </p>
      </Section>

      <Section
        tone="raised"
        eyebrow="In an organization"
        title="Everyone sees the part that concerns them"
      >
        <div className={styles.rolesGrid}>
          {ORGANIZATION_ROLES.map((entry) => (
            <article key={entry.role} className={styles.roleCard}>
              <h3 className={styles.roleTitle}>{entry.role}</h3>
              <p className={styles.roleDetail}>{entry.detail}</p>
            </article>
          ))}
        </div>
        <p className={styles.rolesNote}>
          Requests, conversations, internal notes, history and role-based access
          work today, and so does bringing somebody in: an administrator invites
          a colleague with the role they should have, and hands them a one-time
          code — nothing is emailed. Roles are managed inside the product too:
          an administrator can change somebody&apos;s role, suspend them, remove
          them, or bring them back. Manager dashboards and in-app notifications
          run behind the API but have no product screens yet. The{' '}
          <Link href="/features" className={styles.inlineLink}>
            features page
          </Link>{' '}
          lists exactly what is available and what is not.
        </p>
      </Section>

      {/* ------------------------------------------- PART B — where AI helps */}

      <Section
        tone="tinted"
        eyebrow="Part 2 · Where AI helps"
        title="It reads the repetitive part, a person decides the rest"
        lead="Support teams spend a lot of their day re-reading long messages to work out what is being asked and how urgent it is. That is the part I want AI to take on."
      >
        <div className={styles.aiExample}>
          <div className={styles.aiColumn}>
            <p className={styles.aiColumnLabel}>What the person wrote</p>
            <blockquote className={styles.aiInput}>
              “I have tried several times since yesterday, but the invoicing
              system rejects my password and I need to register payments before
              2 PM.”
            </blockquote>
          </div>

          <div className={styles.aiColumn}>
            <div className={styles.aiOutputHead}>
              <p className={styles.aiColumnLabel}>
                <SparklesIcon size={14} />
                What AI would suggest
              </p>
              <StatusPill
                status={capability('ai-assistance', 'Summarization').status}
              />
            </div>
            <dl className={styles.aiRows}>
              {AI_SUGGESTIONS.map((row) => (
                <div key={row.label} className={styles.aiRow}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <p className={styles.aiRule}>
          AI suggestions are reviewed by a person. The support team remains
          responsible for the final decision.
        </p>
        <p className={styles.aiStatusNote}>
          Summaries, classification, priority suggestions and reply drafts are{' '}
          <StatusPill
            status={capability('ai-assistance', 'Summarization').status}
          />
          : the service that produces them runs behind the gateway, and staff
          see them as a panel on the ticket. The Google Gemini integration is
          implemented and verified locally, but each deployment configures its
          own provider credentials before enabling it — without them a
          deterministic local provider answers instead, and the panel names
          whichever one produced what you are reading. Duplicate detection is
          still{' '}
          <StatusPill
            status={capability('ai-assistance', 'Duplicate detection').status}
          />
          .
        </p>
      </Section>

      {/* --------------------------------------- PART C — how it is built */}

      <Section
        tone="technical"
        eyebrow="Part 3 · How the platform is built"
        title="A short version, for the curious"
        lead="Each request travels through a small set of independent services. Nothing here is required to use the product — it is here because how it is built is part of what this project is about."
      >
        <Reveal>
          <ArchitectureDiagram />
        </Reveal>
        <div className={styles.engineeringCta}>
          <ButtonLink href="/engineering">
            Explore the engineering
            <ArrowRightIcon size={16} />
          </ButtonLink>
          <p className={styles.engineeringNote}>
            The stack, the services, the event contracts, testing, observability
            and the decision records all live there.
          </p>
        </div>
      </Section>
    </div>
  );
}
