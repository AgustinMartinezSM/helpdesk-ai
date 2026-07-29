import { AppShell } from '../../components/app-shell';

/** Authenticated product surface — the Sprint 7.5 application shell. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
