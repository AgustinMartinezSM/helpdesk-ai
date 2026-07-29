import './global.css';
import { Inter } from 'next/font/google';
import { AppShell } from '../components/app-shell';
import { AuthProvider } from '../components/auth-context';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata = {
  title: 'HelpDesk AI',
  description:
    'Help desk platform with AI-assisted support workflows. Platform foundation stage.',
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
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
