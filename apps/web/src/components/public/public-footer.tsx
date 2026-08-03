import Link from 'next/link';
import { PUBLIC_NAV_LINKS, siteConfig } from '../../lib/site-config';
import { Mark } from '../brand/mark';
import { HelpiRestore } from '../helpi';
import styles from './public-footer.module.css';

/**
 * Server component. External links render only when configured — the
 * footer must never contain a dead link.
 */
export function PublicFooter() {
  const externalLinks = [
    siteConfig.githubUrl
      ? { href: siteConfig.githubUrl, label: 'GitHub' }
      : null,
    siteConfig.linkedinUrl
      ? { href: siteConfig.linkedinUrl, label: 'LinkedIn' }
      : null,
    siteConfig.contactEmail
      ? { href: `mailto:${siteConfig.contactEmail}`, label: 'Email' }
      : null,
  ].filter((link): link is { href: string; label: string } => link !== null);

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.columns}>
          <div className={styles.brandColumn}>
            <p className={styles.wordmark}>
              <Mark size={24} />
              <span className={styles.wordmarkText}>
                HelpDesk <span>AI</span>
              </span>
            </p>
            <p className={styles.tagline}>
              Support operations, improved by artificial intelligence — with
              human control over every important decision.
            </p>
            <p className={styles.status}>
              Portfolio project · in active development
            </p>
          </div>

          <nav className={styles.column} aria-label="Product">
            <p className={styles.columnTitle}>Product</p>
            {PUBLIC_NAV_LINKS.filter((link) =>
              ['/', '/how-it-works', '/features'].includes(link.href),
            ).map((link) => (
              <Link key={link.href} href={link.href} className={styles.link}>
                {link.label}
              </Link>
            ))}
            <Link href="/login" className={styles.link}>
              Sign in
            </Link>
          </nav>

          <nav className={styles.column} aria-label="Trust">
            <p className={styles.columnTitle}>Trust</p>
            <Link href="/security" className={styles.link}>
              Security
            </Link>
            <Link href="/engineering" className={styles.link}>
              Engineering
            </Link>
            <Link href="/about" className={styles.link}>
              About
            </Link>
            <Link href="/contact" className={styles.link}>
              Contact
            </Link>
            {/* Only renders once Helpi has been dismissed. */}
            <HelpiRestore />
          </nav>

          {externalLinks.length > 0 ? (
            <nav className={styles.column} aria-label="Elsewhere">
              <p className={styles.columnTitle}>Elsewhere</p>
              {externalLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={styles.link}
                  rel="noreferrer"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          ) : null}
        </div>

        <div className={styles.bottomBar}>
          <p>{siteConfig.attribution}</p>
          <p className={styles.bottomNote}>
            Demo environment — no production data.
          </p>
        </div>
      </div>
    </footer>
  );
}
