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
 * preference is the fallback.
 */
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`;

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
