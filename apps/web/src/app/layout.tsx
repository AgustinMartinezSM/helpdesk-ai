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
  title: {
    default: 'HelpDesk AI — Intelligent support operations',
    template: '%s — HelpDesk AI',
  },
  description:
    'Support operations platform: centralize requests, keep humans in control of every decision, and — on the roadmap — assist support teams with AI. A portfolio project by Agustín Martínez.',
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
