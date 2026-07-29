import { PublicFooter } from '../../components/public/public-footer';
import { PublicNav } from '../../components/public/public-nav';
import styles from './layout.module.css';

/**
 * Public product surface: marketing/portfolio pages plus the login entry
 * point. Content pages are Server Components; interactivity lives in
 * small client islands (nav, theme toggle, contact form).
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <PublicNav />
      {/* tabIndex -1 so the skip link actually moves focus, not just scroll. */}
      <main id="main-content" tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
