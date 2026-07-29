import { AppShell } from '../../components/app-shell';
import { Helpi } from '../../components/helpi';

/** Authenticated product surface — the Sprint 7.5 application shell. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell>{children}</AppShell>
      {/*
        Sibling of the shell, not a child: the shell's header carries a
        backdrop-filter, and such an ancestor becomes the containing block
        for position: fixed. Anchored left here because every primary
        button in the app sits bottom-right.
      */}
      <Helpi side="left" />
    </>
  );
}
