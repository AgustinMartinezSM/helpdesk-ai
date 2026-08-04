'use client';

import { AppShell } from '../../components/app-shell';
import { useAuth } from '../../components/auth-context';
import { Helpi } from '../../components/helpi';

/**
 * Authenticated product surface — the Sprint 7.5 application shell.
 *
 * **The `key` is not decoration.** Since Sprint 10.6 the active organization
 * can change without a navigation, and the screens underneath hold state that
 * belongs to the organization they loaded it from: the settings panel seeds
 * its name field once and would rename the NEW organization to the old one's
 * name, the branch and team panels hold open-row ids, and the People screen
 * holds an issued invitation code no endpoint can reissue. Keying the subtree
 * on the organization remounts all of it at once, which is the only version of
 * this that a new screen cannot forget to implement.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();

  return (
    <>
      <AppShell>
        <div key={session?.organizationId ?? 'no-organization'}>{children}</div>
      </AppShell>
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
