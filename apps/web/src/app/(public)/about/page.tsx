import type { Metadata } from 'next';
import { Section } from '../../../components/public/section';
import { ButtonLink } from '../../../components/ui/button';
import { siteConfig } from '../../../lib/site-config';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Why HelpDesk AI exists: a portfolio project built with enterprise discipline by Agustín Martínez to explore support operations, event-driven architecture and honest AI.',
};

const PRINCIPLES = [
  {
    title: 'Quality over speed',
    detail:
      'Every sprint ends with a full gate — lint, tests, build, typecheck — and an adversarial review before it is called done.',
  },
  {
    title: 'Architecture before implementation',
    detail:
      'Design documents and ADRs come first. Code follows a decision, never the other way around.',
  },
  {
    title: 'Human control over AI suggestions',
    detail:
      'AI output is always a suggestion with a visible label. Acting on it is a person’s decision, recorded like any other.',
  },
  {
    title: 'Security as a product requirement',
    detail:
      'Hashing, rotation, guards and validation were built before features that would need them, not patched on after.',
  },
  {
    title: 'Documentation as implementation',
    detail:
      'Progress logs, ADRs and honest status labels ship with the code. If it is not documented, it is not finished.',
  },
  {
    title: 'Every decision must be defensible',
    detail:
      'Monorepo, BFF, events, database ownership — each choice has a written rationale that survives an interview.',
  },
];

const LEARNING = [
  'Designing an event-driven microservice platform end to end — contracts, queues, DLQs, projections',
  'Running a disciplined delivery process alone: plans, phases, gates and adversarial reviews',
  'Building a design system and an accessible product UI without a component library',
  'Treating documentation, security posture and honesty as deliverables, not chores',
];

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>About</p>
          <h1 className={styles.title}>
            A real platform, built to prove a way of working
          </h1>
          <p className={styles.lead}>
            HelpDesk AI is a portfolio project by {siteConfig.author} — not a
            company, not a startup, and not pretending to be one. It exists to
            answer a concrete question: what does it look like to build an
            enterprise-grade support platform, alone, without cutting the
            corners that real teams are not allowed to cut?
          </p>
        </div>
      </header>

      <Section
        eyebrow="Why this project"
        title="Support operations, chosen on purpose"
      >
        <div className={styles.prose}>
          <p>
            A help desk is deceptively simple and quietly hard: roles with
            different permissions, a lifecycle with rules, collaboration under
            pressure, notifications nobody wants twice, and a paper trail that
            has to be beyond dispute. It is the perfect scale model of an
            enterprise system — small enough to build alone, rich enough to
            demand real architecture.
          </p>
          <p>
            It is also the right place to explore AI honestly. Support work is
            full of repetitive analysis that machines do well — summarizing,
            classifying, estimating urgency — and full of decisions that should
            stay human. This project draws that line deliberately: AI assists,
            people decide, and the audit trail records both.
          </p>
        </div>
      </Section>

      <Section
        tone="raised"
        eyebrow="Principles"
        title="The rules the project is built under"
      >
        <div className={styles.principlesGrid}>
          {PRINCIPLES.map((principle) => (
            <article key={principle.title} className={styles.principleCard}>
              <h3 className={styles.principleTitle}>{principle.title}</h3>
              <p className={styles.principleDetail}>{principle.detail}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="The developer"
        title="What this demonstrates"
        lead="Beyond the product itself, this repository is a working record of how I build software."
      >
        <ul className={styles.learningList} role="list">
          {LEARNING.map((item) => (
            <li key={item} className={styles.learningItem}>
              {item}
            </li>
          ))}
        </ul>
        <p className={styles.signature}>{siteConfig.attribution}</p>
        <div className={styles.actions}>
          <ButtonLink href="/engineering">See the engineering</ButtonLink>
          <ButtonLink href="/contact" variant="secondary">
            Get in touch
          </ButtonLink>
        </div>
      </Section>
    </div>
  );
}
