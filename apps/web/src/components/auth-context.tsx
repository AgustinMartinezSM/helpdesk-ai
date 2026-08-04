'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  chooseOrganizationRequest,
  loginRequest,
  logoutRequest,
  refreshRequest,
  type BrowserSession,
} from '../lib/session';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  session: BrowserSession | null;
  login(
    email: string,
    password: string,
    sharedWorkstation?: boolean,
  ): Promise<void>;
  logout(): Promise<void>;
  /**
   * Re-mints the session from the refresh cookie.
   *
   * Needed because some server-side changes do not reach an already-issued
   * token: accepting an invitation creates the membership but leaves the
   * caller's current token carrying no organization, so without this the
   * person joins and still appears to belong nowhere. It is also how a
   * permission snapshot (ADR 0020) is brought up to date deliberately rather
   * than by waiting out the access-token lifetime.
   */
  refresh(): Promise<void>;
  /**
   * Acts in another organization from now on (Sprint 10.6, ADR 0025).
   *
   * Not a variant of `refresh()`: the server mints a token for the requested
   * organization and REFUSES if the person cannot act there, so the rejection
   * has to reach the caller rather than being swallowed into `anonymous` the
   * way a failed refresh is. On success the whole session is replaced, because
   * permissions, branch and team scope all change with the organization.
   */
  switchOrganization(organizationId: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the session in React state only — a page reload drops the access
 * token on purpose and recovers it through the BFF's httpOnly refresh
 * cookie (silent refresh on mount).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<BrowserSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    refreshRequest()
      .then((recovered) => {
        if (cancelled) {
          return;
        }
        setSession(recovered);
        setStatus(recovered ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('anonymous');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string, sharedWorkstation?: boolean) => {
      const next = await loginRequest(email, password, sharedWorkstation);
      setSession(next);
      setStatus('authenticated');
    },
    [],
  );

  const refresh = useCallback(async () => {
    const recovered = await refreshRequest();
    setSession(recovered);
    setStatus(recovered ? 'authenticated' : 'anonymous');
  }, []);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      if (!session) {
        throw new Error('Sign in before choosing an organization');
      }
      // Deliberately NOT wrapped in a try that falls back to anonymous. A
      // refused switch means "you cannot act there", which the caller has to
      // be able to show; treating it like a dead session would sign somebody
      // out of a session that is perfectly valid.
      const next = await chooseOrganizationRequest(
        session.accessToken,
        organizationId,
      );
      setSession(next);
      setStatus('authenticated');
    },
    [session],
  );

  const logout = useCallback(async () => {
    await logoutRequest();
    setSession(null);
    setStatus('anonymous');
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        session,
        login,
        logout,
        refresh,
        switchOrganization,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
