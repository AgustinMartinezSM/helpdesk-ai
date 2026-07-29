import type { Metadata } from 'next';
import { CapabilityCard } from '../../../components/public/capability-card';
import { Reveal } from '../../../components/public/reveal';
import { Section } from '../../../components/public/section';
import { StatusPill } from '../../../components/public/status-pill';
import { ButtonLink } from '../../../components/ui/button';
import { CAPABILITY_AREAS } from '../../../lib/product-status';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Every capability of HelpDesk AI grouped by area — support operations, AI assistance, collaboration, security and analytics — each labeled with its honest status.',
};

export default function FeaturesPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>Features</p>
          <h1 className={styles.title}>Capabilities, with their real status</h1>
          <p className={styles.lead}>
            Nothing here is aspirational marketing:{' '}
            <StatusPill status="available" /> works end-to-end in the product,{' '}
            <StatusPill status="api-ready" /> is implemented behind the gateway
            with its product UI pending, and <StatusPill status="planned" /> is
            designed but not built.
          </p>
        </div>
      </header>

      {CAPABILITY_AREAS.map((area, areaIndex) => (
        <Section
          key={area.key}
          id={area.key}
          tone={areaIndex % 2 === 1 ? 'raised' : 'default'}
          title={area.title}
          lead={area.description}
        >
          <div className={styles.grid}>
            {area.capabilities.map((capability, index) => (
              <Reveal key={capability.name} delay={(index % 4) * 60}>
                <CapabilityCard capability={capability} />
              </Reveal>
            ))}
          </div>
        </Section>
      ))}

      <div className={styles.ctaBand}>
        <p className={styles.ctaText}>
          Want to see the available capabilities working against the real
          backend?
        </p>
        <div className={styles.ctaActions}>
          <ButtonLink href="/login">Sign in to the demo</ButtonLink>
          <ButtonLink href="/how-it-works" variant="secondary">
            Follow the workflow
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
