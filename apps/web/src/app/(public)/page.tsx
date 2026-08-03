import type { Metadata } from 'next';
import Link from 'next/link';
import { ArchitectureDiagram } from '../../components/public/architecture-diagram';
import { CapabilityCard } from '../../components/public/capability-card';
import { HeroVisual } from '../../components/public/hero-visual';
import { Reveal } from '../../components/public/reveal';
import { Section } from '../../components/public/section';
import { ButtonLink } from '../../components/ui/button';
import {
  ArrowRightIcon,
  BarChartIcon,
  BellIcon,
  ClockIcon,
  FileTextIcon,
  LockIcon,
  MessageSquareIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TicketIcon,
  UserIcon,
  UsersIcon,
  ZapIcon,
} from '../../components/ui/icons';
import { LANDING_CAPABILITIES, PROJECT_STATUS } from '../../lib/product-status';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: {
    absolute: 'HelpDesk AI — Support operations, improved by AI',
  },
  description:
    'Centralize requests, assist support teams, automate repetitive analysis, and preserve human control over every important decision.',
};

const ROLE_VALUE = [
  {
    icon: <UserIcon size={18} />,
    role: 'Employees',
    value:
      'Open a request in seconds, follow its progress, and confirm the fix yourself — your request stays yours.',
  },
  {
    icon: <UsersIcon size={18} />,
    role: 'Technicians',
    value:
      'Work a clear queue with priorities, internal notes and full history, and read AI triage suggestions before deciding anything.',
  },
  {
    icon: <BarChartIcon size={18} />,
    role: 'Team managers',
    value:
      'Route work to the team that resolves it, and see volumes and resolution flow projected live from the event stream.',
  },
  {
    icon: <ShieldCheckIcon size={18} />,
    role: 'Administrators',
    value:
      'Every action is validated, role-guarded and recorded in an immutable audit trail you can rely on.',
  },
];

const CAPABILITY_ICONS: Record<string, React.ReactNode> = {
  'Ticket lifecycle': <TicketIcon size={17} />,
  'Role-based access': <LockIcon size={17} />,
  'Internal notes': <MessageSquareIcon size={17} />,
  'Ticket history': <ClockIcon size={17} />,
  Summarization: <SparklesIcon size={17} />,
  Classification: <SparklesIcon size={17} />,
  'Priority suggestion': <ZapIcon size={17} />,
  'Suggested replies': <MessageSquareIcon size={17} />,
  'Duplicate detection': <SearchIcon size={17} />,
  Notifications: <BellIcon size={17} />,
  'Ticket metrics': <BarChartIcon size={17} />,
  Auditability: <FileTextIcon size={17} />,
};

const WORKFLOW_PREVIEW = [
  {
    step: '01',
    title: 'A request arrives',
    text: 'Validated, persisted and visible to the team immediately.',
  },
  {
    step: '02',
    title: 'An event is published',
    text: 'Every change becomes a domain event on RabbitMQ.',
  },
  {
    step: '03',
    title: 'AI reads the repetitive part',
    text: 'Category, priority and summary arrive as suggestions.',
  },
  {
    step: '04',
    title: 'A person decides',
    text: 'Technicians review, act and stay responsible. Always.',
  },
];

const SECURITY_PRINCIPLES = [
  'argon2id password hashing with refresh token rotation',
  'Access tokens live in memory, sessions in httpOnly cookies',
  'Role guards on every protected endpoint of every service',
  'Explicit DTO validation before anything reaches a domain',
  'One database per service — no shared state',
  'Immutable, event-sourced audit trail',
];

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.heroEyebrow}>
              HelpDesk AI · intelligent support operations
            </p>
            <h1 className={styles.heroTitle}>
              Support operations, improved by{' '}
              <span>artificial intelligence.</span>
            </h1>
            <p className={styles.heroLead}>
              Centralize requests, assist support teams, automate repetitive
              analysis — and preserve human control over every important
              decision.
            </p>
            <div className={styles.heroActions}>
              <ButtonLink href="/how-it-works">
                See how it works
                <ArrowRightIcon size={16} />
              </ButtonLink>
              <ButtonLink href="/engineering" variant="secondary">
                Explore the architecture
              </ButtonLink>
            </div>
            <p className={styles.heroNote}>
              Portfolio project — real platform, honest roadmap, no invented
              claims. The application runs locally from the repository; there is
              no hosted demo yet.
            </p>
          </div>
          <HeroVisual />
        </div>
      </section>

      <Section
        tone="raised"
        eyebrow="Who it serves"
        title="One platform, four jobs done well"
        lead="Support is a team sport. HelpDesk AI gives each role exactly the surface it needs — nothing more, nothing less."
      >
        <div className={styles.rolesGrid}>
          {ROLE_VALUE.map((entry, index) => (
            <Reveal key={entry.role} delay={index * 70}>
              <article className={styles.roleCard}>
                <span className={styles.roleIcon}>{entry.icon}</span>
                <h3 className={styles.roleName}>{entry.role}</h3>
                <p className={styles.roleValue}>{entry.value}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section
        tone="sunken"
        eyebrow="Capabilities"
        title="Everything a support operation needs"
        lead="Shipped capabilities are labeled Available. Anything not usable today says so — clearly."
      >
        <div className={styles.capabilitiesGrid}>
          {LANDING_CAPABILITIES.map((capability, index) => (
            <Reveal key={capability.name} delay={(index % 4) * 60}>
              <CapabilityCard
                capability={capability}
                icon={CAPABILITY_ICONS[capability.name]}
              />
            </Reveal>
          ))}
        </div>
        <div className={styles.sectionCta}>
          <Link href="/features" className={styles.inlineLink}>
            See all capabilities and their status
            <ArrowRightIcon size={15} />
          </Link>
        </div>
      </Section>

      <Section
        eyebrow="How it works"
        title="From request to resolution, with people in charge"
        lead="A ticket flows through validation, events and AI analysis. The final action is always a human decision."
      >
        <ol className={styles.workflowGrid} role="list">
          {WORKFLOW_PREVIEW.map((entry, index) => (
            <Reveal
              as="li"
              key={entry.step}
              className={styles.workflowStep}
              delay={index * 70}
            >
              <span className={styles.workflowIndex}>{entry.step}</span>
              <h3 className={styles.workflowTitle}>{entry.title}</h3>
              <p className={styles.workflowText}>{entry.text}</p>
            </Reveal>
          ))}
        </ol>
        <div className={styles.sectionCta}>
          <Link href="/how-it-works" className={styles.inlineLink}>
            Follow the complete workflow
            <ArrowRightIcon size={15} />
          </Link>
        </div>
      </Section>

      <Section
        tone="raised"
        eyebrow="Security & reliability"
        title="Built like it holds real data"
        lead="No certifications are claimed and none are invented — these are engineering decisions you can read in the code."
      >
        <ul className={styles.securityGrid} role="list">
          {SECURITY_PRINCIPLES.map((principle) => (
            <li key={principle} className={styles.securityItem}>
              <ShieldCheckIcon size={16} className={styles.securityIcon} />
              {principle}
            </li>
          ))}
        </ul>
        <div className={styles.sectionCta}>
          <Link href="/security" className={styles.inlineLink}>
            Read the security principles
            <ArrowRightIcon size={15} />
          </Link>
        </div>
      </Section>

      <Section
        tone="technical"
        eyebrow="Architecture"
        title="An event-driven platform, end to end"
        lead="Eleven applications and four libraries in an Nx monorepo — each service owns its data and reacts to events."
      >
        <Reveal>
          <ArchitectureDiagram />
        </Reveal>
        <div className={styles.sectionCta}>
          <Link href="/engineering" className={styles.inlineLink}>
            Explore the engineering decisions
            <ArrowRightIcon size={15} />
          </Link>
        </div>
      </Section>

      <Section
        tone="tinted"
        eyebrow="Project status"
        title="Exactly where the project stands"
        lead="Derived from the repository and roadmap — updated as the project moves."
      >
        <div className={styles.statusGrid}>
          {PROJECT_STATUS.map((group) => (
            <div key={group.title} className={styles.statusColumn}>
              <h3 className={styles.statusTitle}>{group.title}</h3>
              <ul className={styles.statusList} role="list">
                {group.items.map((item) => (
                  <li key={item} className={styles.statusItem}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <section className={styles.finalCta}>
        <div className={styles.finalCtaInner}>
          <h2 className={styles.finalCtaTitle}>Take a closer look</h2>
          <p className={styles.finalCtaLead}>
            Follow the workflow end to end, read how the platform is put
            together, or ask about any decision behind it.
          </p>
          <div className={styles.finalCtaActions}>
            <ButtonLink href="/how-it-works">Follow the workflow</ButtonLink>
            <ButtonLink href="/engineering" variant="secondary">
              Read the engineering
            </ButtonLink>
            <ButtonLink href="/contact" variant="ghost">
              Contact the developer
            </ButtonLink>
          </div>
          <p className={styles.finalCtaNote}>
            Running the product UI needs the local stack from the repository —
            there is no hosted demo environment yet.
          </p>
        </div>
      </section>
    </div>
  );
}
