import './global.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '../components/auth-context';
import { siteConfig } from '../lib/site-config';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  // Real deployments set NEXT_PUBLIC_SITE_URL; locally Next falls back
  // to localhost, which is fine for a not-yet-deployed portfolio build.
  ...(siteConfig.siteUrl ? { metadataBase: new URL(siteConfig.siteUrl) } : {}),
  // The descriptor slot of the tagline architecture (brand-strategy.md).
  // Four near-taglines used to compete here, in the landing title, the
  // footer and the app shell; this is the one that states the category.
  title: {
    default: 'HelpDesk AI — help desk for internal requests',
    template: '%s — HelpDesk AI',
  },
  // No capability status in here. It used to say AI was "on the roadmap",
  // which had been wrong for nine sprints and which no page could correct,
  // because metadata renders nothing from product-status.ts (ADR 0009).
  description:
    'Every request gets a place, an owner and an ending. HelpDesk AI turns support requests that arrive by message, by phone or in a hallway into requests with a branch, a team and a history — and the person who asked confirms when it is done. A portfolio project by Agustín Martínez.',
  applicationName: 'HelpDesk AI',
  authors: [{ name: 'Agustín Martínez' }],
  // No title/description here on purpose: Next would otherwise freeze this
  // pair into every page's social preview instead of inheriting each
  // route's own metadata.
  openGraph: {
    siteName: 'HelpDesk AI',
    type: 'website',
  },
};

/**
 * Resolves the theme before hydration so the first paint already has the
 * right `data-theme` — no light/dark flash. localStorage wins; the OS
 * preference is the fallback. The storage read gets its own try/catch:
 * where storage access itself throws (blocked cookies, sandboxed
 * webviews) the OS-preference fallback must still run.
 */
const themeInit = `(function(){var t=null;try{t=localStorage.getItem('theme')}catch(e){}if(t!=='light'&&t!=='dark'){try{t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch(e){t='light'}}document.documentElement.dataset.theme=t})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
