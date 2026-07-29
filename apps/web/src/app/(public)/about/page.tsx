import type { Metadata } from 'next';
import { Section } from '../../../components/public/section';
import { ButtonLink } from '../../../components/ui/button';
import { siteConfig } from '../../../lib/site-config';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Why I built HelpDesk AI: asking for help at work is usually more disorganized than it should be, and I wanted to fix that with real engineering instead of a demo.',
};

const PRINCIPLES = [
  {
    title: 'Quality over speed',
    detail:
      'I finish a sprint when lint, tests, build and typecheck all pass and an adversarial review has torn the work apart — not when the feature appears to work.',
  },
  {
    title: 'Architecture before implementation',
    detail:
      'I write the decision down first. If I cannot explain why a boundary exists before I code it, I am not ready to code it.',
  },
  {
    title: 'People decide, AI assists',
    detail:
      'I want AI to remove busywork, not authority. Every suggestion is labeled as one, and a person chooses what happens next.',
  },
  {
    title: 'Security is part of the feature',
    detail:
      'I built hashing, token rotation, guards and validation before the features that would need them, because retrofitting security is how you end up with none.',
  },
  {
    title: 'If it is not documented, it is not done',
    detail:
      'Decision records, sprint logs and honest status labels ship with the code. Documentation is how a decision survives me forgetting it.',
  },
  {
    title: 'Every decision must be defensible',
    detail:
      'I should be able to sit across from anyone and explain why the monorepo, the BFF, the events and the database boundaries are the way they are.',
  },
];

const LEARNING = [
  'How to design an event-driven platform end to end — contracts, queues, dead letters and projections that stay correct',
  'How to run a real delivery process alone: plans, phases, quality gates and reviews that are allowed to say no',
  'How to build a design system and an accessible interface without reaching for a component library',
  'How to treat documentation, security and honesty as things I ship, not chores I postpone',
];

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>About</p>
          <h1 className={styles.title}>Why I am building HelpDesk AI</h1>
          <p className={styles.lead}>
            I started this project because I wanted to work on a problem that
            shows up in almost every workplace: asking for help is usually more
            disorganized than it should be.
          </p>
        </div>
      </header>

      <Section eyebrow="The problem" title="Help gets lost between the cracks">
        <div className={styles.prose}>
          <p>
            Think about how a request for help usually travels. Someone sends a
            direct message. Someone else replies in an email thread. A third
            person mentions it in passing, and it ends up in a spreadsheet that
            only one team keeps updated.
          </p>
          <p>
            What I kept noticing is what happens next: nobody is sure who is
            handling it, the same problem gets explained three times to three
            people, the context lives in a chat nobody else can read, and some
            requests are simply forgotten. The people supporting others end up
            spending their time organizing information instead of solving the
            actual problem.
          </p>
          <blockquote className={styles.pullQuote}>
            I wanted a place where a request stops being a message and starts
            being something you can follow.
          </blockquote>
        </div>
      </Section>

      <Section
        tone="tinted"
        eyebrow="What I wanted to build"
        title="One place where a request stays whole"
      >
        <div className={styles.prose}>
          <p>So I set out to build something simple to describe:</p>
          <ul className={styles.wantList} role="list">
            <li>A person can ask for help without knowing any procedure.</li>
            <li>The request stays organized instead of scattering.</li>
            <li>Anyone involved can see its status at a glance.</li>
            <li>The whole conversation lives in one place.</li>
            <li>
              The support team gets the full context without asking for it
              again.
            </li>
            <li>Every important action leaves a trace you can go back to.</li>
            <li>
              AI takes the repetitive part off the team&apos;s hands — without
              taking the decisions.
            </li>
          </ul>
        </div>
      </Section>

      <Section
        eyebrow="Why not something simpler"
        title="I wanted the project to be harder than it needed to be"
      >
        <div className={styles.prose}>
          <p>
            I could have built a form, a table and a database and called it a
            help desk. I deliberately did not. I wanted to know what it actually
            takes to build a product the way a real team has to build one — and
            the only honest way to find out was to do it.
          </p>
          <p>
            That meant sitting with the parts that are easy to skip when nobody
            is watching: who is allowed to do what, how services stay
            independent without lying to each other, what happens when a message
            arrives twice or not at all, how I would know something broke, what
            I test and why, and how a decision made in month one is still
            understandable in month six.
          </p>
          <p>
            None of that shows up in a screenshot. All of it shows up the moment
            a product has to survive contact with real use.
          </p>
        </div>
      </Section>

      <Section
        tone="tinted"
        eyebrow="How I think about AI"
        title="An assistant, not an authority"
      >
        <div className={styles.prose}>
          <p>
            Support work is full of reading the same thing over and over:
            summarizing a long thread, guessing a category, judging how urgent
            something really is, drafting the reply you have written fifty times
            before. That is exactly the kind of work I want AI to take on.
          </p>
          <p>
            What I do not want is for it to decide. I am not comfortable with a
            system that closes a ticket, reassigns someone&apos;s work or tells
            a person their problem is low priority on its own. So the line I
            drew is deliberate: AI reads, summarizes and suggests — the
            technician reviews it and remains responsible for what actually
            happens. The history records both, so it is always clear which was
            which.
          </p>
        </div>
      </Section>

      <Section
        eyebrow="How I work"
        title="The rules I hold myself to"
        lead="These are not aspirations I wrote for this page. They are the constraints I actually work under, and the reason the project moves at the pace it does."
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
        tone="tinted"
        eyebrow="What this means to me"
        title="A product I am building, and how I am growing through it"
      >
        <div className={styles.prose}>
          <p>
            HelpDesk AI is not a company and I am not pretending it is one.
            There are no clients, no funding and no production users, and you
            will not find invented numbers anywhere on this site. It is a real
            platform I am building on my own, in the open, one sprint at a time.
          </p>
          <p>What I am learning by doing it:</p>
          <ul className={styles.learningList} role="list">
            {LEARNING.map((item) => (
              <li key={item} className={styles.learningItem}>
                {item}
              </li>
            ))}
          </ul>
          <p>
            If you want to see whether I can defend any of it, the engineering
            page is where the decisions live — and I am happy to be asked about
            the ones you disagree with.
          </p>
        </div>
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
