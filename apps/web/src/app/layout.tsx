import './global.css';
import { AuthProvider } from '../components/auth-context';

export const metadata = {
  title: 'HelpDesk AI',
  description:
    'Help desk platform with AI-assisted support workflows. Platform foundation stage.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
