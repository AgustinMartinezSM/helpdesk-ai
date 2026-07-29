import type { Metadata } from 'next';
import { ContactForm } from '../../../components/public/contact-form';
import { siteConfig } from '../../../lib/site-config';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Get in touch with Agustín Martínez about HelpDesk AI — recruiting, technical feedback or questions about the architecture.',
};

export default function ContactPage() {
  const directLinks = [
    siteConfig.contactEmail
      ? { href: `mailto:${siteConfig.contactEmail}`, label: 'Email' }
      : null,
    siteConfig.githubUrl
      ? { href: siteConfig.githubUrl, label: 'GitHub' }
      : null,
    siteConfig.linkedinUrl
      ? { href: siteConfig.linkedinUrl, label: 'LinkedIn' }
      : null,
  ].filter((link): link is { href: string; label: string } => link !== null);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>Contact</p>
          <h1 className={styles.title}>Talk to the developer</h1>
          <p className={styles.lead}>
            Questions about a decision, feedback on the product, or a
            conversation about working together — all welcome. I read
            everything.
          </p>
        </div>
      </header>

      <div className={styles.content}>
        <ContactForm />

        <aside className={styles.aside}>
          <h2 className={styles.asideTitle}>Prefer something direct?</h2>
          {directLinks.length > 0 ? (
            <ul className={styles.linkList}>
              {directLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className={styles.directLink}
                    rel="noreferrer"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.asideNote}>
              Direct contact links are not configured in this environment — they
              render automatically when the deployment sets them.
            </p>
          )}
          <p className={styles.asideNote}>
            {siteConfig.attribution} The form above prepares a message honestly:
            this demo has no email backend, and it says so instead of
            pretending.
          </p>
        </aside>
      </div>
    </div>
  );
}
